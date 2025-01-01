import express from 'express';
import fetch from 'node-fetch';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import supabase from './supabaseClient.js';
import assistantHandler from './assistant.js';
import {
  fetchInstagramIdFromDatabase,
  ensurePageAccessToken,
  fetchInstagramIdFromFacebook,
  fetchInstagramUserInfo,
  logMessage,
  parseUserMessage,
  fetchBusinessDetails,
  getPageAccessToken,
  sendInstagramMessage,
  upsertInstagramUser,
} from './helpers.js';

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
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('id')
      .eq('ig_id', igId)
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
async function respondAndLog(businessId, senderId, recipientId, messageText, igId, username) {
  try {
    // Fetch the page access token
    const pageAccessToken = await getPageAccessToken(businessId, businessDetails.page_id);
    if (!pageAccessToken) {
      console.error(`[ERROR] Missing page access token for businessId=${businessId}`);
      return;
    }

    // Send the message
    await sendInstagramMessage(senderId, messageText, pageAccessToken);
    
    // Log the sent message
    await logMessage(
      businessId,
      senderId,
      recipientId,
      messageText,
      'sent',
      null,
      true,
      igId,
      username
    );
  } catch (err) {
    console.error(`[ERROR] Failed to respond and log message for businessId=${businessId}:`, err.message);
  }
}

async function processMessagingEvent(messageEvent) {
  try {
    console.log('[DEBUG] Incoming message payload:', JSON.stringify(messageEvent, null, 2));

    const senderId = messageEvent.sender?.id;
    const recipientId = messageEvent.recipient?.id;

    if (!senderId || !recipientId) {
      console.error('[ERROR] senderId or recipientId is missing in message payload.');
      return;
    }

    const isDeleted = messageEvent.message?.is_deleted || false;
    const isEcho = messageEvent.message?.is_echo || false;
    const userMessage = messageEvent.message?.text || '';
    const messageId = messageEvent.message?.mid;

    const igId = isEcho ? senderId : recipientId;
    console.log(`[DEBUG] Using Instagram ID: ${igId}`);

    const businessId = await fetchBusinessIdFromInstagramId(igId);
    if (!businessId) {
      console.error('[ERROR] Could not resolve businessId for Instagram ID:', igId);
      return;
    }

    const businessDetails = await fetchBusinessDetails(businessId);
    if (!businessDetails) {
      console.error(`[ERROR] Could not fetch business details for businessId=${businessId}`);
      return;
    }

    const { page_id: pageId } = businessDetails;

    if (isDeleted) {
      if (!messageId) {
        console.error('[WARN] Deleted message does not have a valid message ID.');
        return;
      }
      console.log(`[INFO] Handling deleted message with ID: ${messageId}`);
      await handleUnsentMessage(messageId, businessId);
      return;
    }

    if (isEcho || !userMessage.trim()) {
      console.log('[INFO] Ignoring echo or empty message.');
      return;
    }

    const userInfo = await fetchInstagramUserInfo(senderId, businessId);
    if (userInfo) {
      console.log(`[DEBUG] Fetched user info: ${JSON.stringify(userInfo)}`);
      await upsertInstagramUser(senderId, userInfo, businessId);
    }

    if (!businessId || !senderId || !recipientId || !userMessage || !messageId) {
      console.error(`[ERROR] Missing required fields for logging message. BusinessId=${businessId}, SenderId=${senderId}, RecipientId=${recipientId}, Message=${userMessage}`);
      return;
    }

    await logMessage(
      businessId,
      senderId,
      recipientId,
      userMessage,
      'received',
      messageId,
      false, // isBusinessMessage
      igId,
      userInfo?.username || ''
    );

    const { field, value } = parseUserMessage(userMessage);
    if (!field || !value) {
      console.warn(`[WARN] User message does not match expected format: ${userMessage}`);
      
      // Generate a generic response
      const assistantResponse = await assistantHandler({ userMessage, businessId });
      
      if (assistantResponse && assistantResponse.message) {
        // Use the helper to respond and log
        await respondAndLog(
          businessId,
          senderId,
          recipientId,
          assistantResponse.message,
          igId,
          userInfo?.username || ''
        );
      } else {
        console.error(`[ERROR] assistantHandler did not return a valid response for businessId=${businessId}`);
      }
      return;
    }

    // Handle messages that match the expected format
    const assistantResponse = await assistantHandler({ userMessage, businessId, field, value });
    
    if (assistantResponse && assistantResponse.message) {
      // Use the helper to respond and log
      await respondAndLog(
        businessId,
        senderId,
        recipientId,
        assistantResponse.message,
        igId,
        userInfo?.username || ''
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

// GET route for verification
router.get('/', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  return res.status(403).send('Verification failed');
});

export default router;
