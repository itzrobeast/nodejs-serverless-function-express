import express from 'express';
import fetch from 'node-fetch';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import supabase from './supabaseClient.js';
import assistantHandler from './assistant.js';
import {
  fetchInstagramIdFromDatabase,
  fetchInstagramIdFromFacebook,
  fetchInstagramUserInfo,
  logMessage,
  parseUserMessage,
  fetchBusinessDetails,
  sendInstagramMessage,
  upsertInstagramUser,
  handleUnsentMessage,
} from './helpers.js';

import {
  getPageAccessToken,
  getUserAccessToken,
  refreshUserAccessToken,
  ensurePageAccessToken,
  getBusinessOwnerId,
  validateUserAccessToken,
  getLongLivedUserAccessToken,
  refreshLongLivedUserAccessToken,
  refreshPageAccessToken,
  isExpired,
} from './auth/refresh-token.js';

const router = express.Router();

// Environment Variables
const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;

if (!VERIFY_TOKEN || !FACEBOOK_APP_SECRET) {
  console.error('[ERROR] Missing required environment variables.');
  throw new Error('Environment variables missing. Cannot start server.');
}

// Middleware for rate limiting and JSON parsing with Facebook signature verification
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
});

function verifyFacebookSignature(req, res, buf) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) throw new Error('Missing X-Hub-Signature-256 header');

  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', FACEBOOK_APP_SECRET)
    .update(buf)
    .digest('hex')}`;

  if (signature !== expectedSignature) throw new Error('Invalid signature');
}

router.use('/', webhookLimiter, express.json({ verify: verifyFacebookSignature }));

// Helper to fetch business ID from Instagram ID
async function fetchBusinessIdFromInstagramId(igId) {
  // Validate igId before proceeding
  if (!igId || isNaN(Number(igId))) {
    console.error('[ERROR] Invalid or missing ig_id:', igId);
    return null;
  }
  
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('id')
      .eq('ig_id', igId)
      .limit(1)
      .single();

    if (error || !data) {
      console.error(`[ERROR] Could not fetch businessId for Instagram ID ${igId}:`, error?.message || 'No data found');
      return null;
    }
    return data.id;
  } catch (err) {
    console.error('[ERROR] Exception while fetching businessId:', err.message);
    return null;
  }
}


async function respondAndLog(
  businessId,
  senderId,
  recipientId,
  messageText,
  igId,
  username,
  businessDetails
) {
  try {
    if (!businessId || !senderId || !recipientId || !messageText || !businessDetails) {
      console.warn('[WARN] Missing required fields for respondAndLog:', {
        businessId, senderId, recipientId, messageText, businessDetails,
      });
      return;
    }

    const pageAccessToken = await getPageAccessToken(businessId, businessDetails.page_id);
    if (!pageAccessToken) {
      console.error(`[ERROR] Missing page access token for businessId=${businessId}`);
      return;
    }

    // Pass businessId and pageId to sendInstagramMessage
    await sendInstagramMessage(
      senderId,
      messageText,
      pageAccessToken,
      businessId,
      businessDetails.page_id
    );

    await logMessage({
      businessId,
      senderId: recipientId, // 'Business' is the sender in this scenario
      recipientId: senderId,
      message: messageText,
      type: 'sent',
      role: 'business',
      igId,
      username: 'Business',
    });
  } catch (err) {
    console.error(`[ERROR] Failed to respond and log message for businessId=${businessId}:`, err.message);
  }
}

async function respondAndLog(
  businessId,
  senderId,
  recipientId,
  messageText,
  igId,
  username,
  businessDetails
) {
  try {
    if (!businessId || !senderId || !recipientId || !messageText || !businessDetails) {
      console.warn('[WARN] Missing required fields for respondAndLog:', {
        businessId, senderId, recipientId, messageText, businessDetails,
      });
      return;
    }

    const pageAccessToken = await getPageAccessToken(businessId, businessDetails.page_id);
    if (!pageAccessToken) {
      console.error(`[ERROR] Missing page access token for businessId=${businessId}`);
      return;
    }

    // Pass businessId and pageId to sendInstagramMessage
    await sendInstagramMessage(
      senderId,
      messageText,
      pageAccessToken,
      businessId,
      businessDetails.page_id
    );

    await logMessage({
      businessId,
      senderId: recipientId, // 'Business' is the sender in this scenario
      recipientId: senderId,
      message: messageText,
      type: 'sent',
      role: 'business',
      igId,
      username: 'Business',
    });
  } catch (err) {
    console.error(`[ERROR] Failed to respond and log message for businessId=${businessId}:`, err.message);
  }
}


// Core function to process incoming messages
/**
 * Sends a message to the user and logs it.
 * @param {string} businessId - The business ID.
 * @param {string} senderId - The sender's Instagram ID.
 * @param {string} recipientId - The recipient's Instagram ID.
 * @param {string} messageText - The message to send.
 * @param {string} igId - The Instagram ID associated with the message.
 * @param {string} username - The username of the sender.
 */

async function processMessagingEvent(messageEvent) {
  try {
    console.log('[DEBUG] Incoming message payload:', JSON.stringify(messageEvent, null, 2));

    // Extract sender and recipient IDs
    const senderId = messageEvent.sender?.id;
    const recipientId = messageEvent.recipient?.id;

    if (!senderId || !recipientId) {
      console.error('[ERROR] senderId or recipientId is missing in message payload.');
      return;
    }

    // Determine whether the message is deleted or an echo
    const isDeleted = messageEvent.message?.is_deleted || false;
    const isEcho = messageEvent.message?.is_echo || false;
    const userMessage = messageEvent.message?.text || '';
    const messageId = messageEvent.message?.mid?.trim();

    // Use recipient ID as the business Instagram ID (igId)
    const igId = recipientId;
    console.log(`[DEBUG] Using Instagram ID: ${igId}`);

    // Fetch business ID using Instagram ID
    const businessId = await fetchBusinessIdFromInstagramId(igId);
    if (!businessId) {
      console.error('[ERROR] Could not resolve businessId for Instagram ID:', igId);
      return;
    }

    // Fetch business details
    const businessDetails = await fetchBusinessDetails(businessId);
    if (!businessDetails) {
      console.error(`[ERROR] Could not fetch business details for businessId=${businessId}`);
      return;
    }

    console.log(`[DEBUG] Business details fetched: ${JSON.stringify(businessDetails)}`);

    // Handle deleted messages
    if (isDeleted) {
      if (!messageId) {
        console.error('[WARN] Deleted message does not have a valid message ID.');
        return;
      }
      console.log(`[INFO] Handling deleted message with ID: ${messageId}`);
      await handleUnsentMessage(messageId, businessId);
      return;
    }

    // Ignore echo messages or empty messages
    if (isEcho || !userMessage.trim()) {
      console.log('[INFO] Ignoring echo or empty message.');
      return;
    }

    // Parse user message for additional information
    const { field, value, location } = parseUserMessage(userMessage);

    // Fetch and upsert Instagram user information
    const userInfo = await fetchInstagramUserInfo(senderId, businessId);
    if (userInfo) {
      console.log(`[DEBUG] Fetched user info: ${JSON.stringify(userInfo)}`);
      await upsertInstagramUser(senderId, userInfo, businessId, 'customer', location);
    }

    // Log the received message
    await logMessage({
      businessId,
      senderId,
      recipientId,
      message: userMessage,
      type: 'received',
      role: 'customer',
      igId, // Pass valid igId from recipient
      username: userInfo?.username || '',
      email: userInfo?.email || null,
      phone_number: userInfo?.phone_number || null,
      location: location || null,
    });

    // Generate a response using the assistant handler
    const assistantResponse = await assistantHandler({
      userMessage,
      businessId,
      field,
      value,
    });

    if (assistantResponse && assistantResponse.message) {
      // Send and log the response
      await respondAndLog(
        businessId,
        senderId,
        recipientId,
        assistantResponse.message,
        igId,
        userInfo?.username || '',
        businessDetails
      );
    } else {
      console.error(`[ERROR] assistantHandler did not return a valid response for businessId=${businessId}`);
    }
  } catch (err) {
    console.error('[ERROR] Failed to process messaging event:', err.message);
  }
}




// POST route for webhook
router.post('/', async (req, res) => {
  try {
    const { object, entry } = req.body;
    if (object === 'instagram') {
      for (const event of entry) {
        if (event.messaging) {
          for (const messageEvent of event.messaging) {
            await processMessagingEvent(messageEvent);
          }
        }
      }
      return res.status(200).send('Instagram messaging handled');
    }
    return res.status(400).send('Unhandled object type');
  } catch (err) {
    console.error('[ERROR] Webhook processing failed:', err.message);
    return res.status(500).send('Webhook processing failed');
  }
});


router.get('/fetch-conversations', async (req, res) => {
  try {
    const { business_id } = req.query;

    if (!business_id) {
      return res.status(400).json({ error: 'Missing required parameter: business_id' });
    }

    console.log(`[INFO] Fetching conversations for business_id=${business_id}`);

    const { data, error } = await supabase
      .from('instagram_conversations')
      .select('*')
      .eq('business_id', business_id);

    if (error) {
      console.error(`[ERROR] Failed to fetch conversations for business_id=${business_id}:`, error.message);
      return res.status(500).json({ error: 'Failed to fetch conversations' });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('[ERROR] Exception while fetching conversations:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


// GET route for verification
router.get('/', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  return res.status(403).send('Verification failed');
});

export default router;
