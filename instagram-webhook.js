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


async function respondAndLog(businessId, senderId, recipientId, messageText, igId, username, businessDetails) {
  try {
    // Fetch the page access token dynamically
    const pageAccessToken = await getPageAccessToken(businessId, businessDetails.page_id);
    if (!pageAccessToken) {
      console.error(`[ERROR] Missing page access token for businessId=${businessId}`);
      return;
    }

    // Send the message via Instagram API
    await sendInstagramMessage(senderId, messageText, pageAccessToken);

    // Log the sent message
    await logMessage(
      businessId,
      senderId,
      recipientId,
      messageText,
      'sent',
      null,
      true, // isBusinessMessage
      igId,
      username
    );
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

const businessOwnerId = await getBusinessOwnerId(businessId);
if (!businessOwnerId) {
  console.error(`[ERROR] Could not resolve business owner ID for Business ID: ${businessId}`);
  return;
}

// Use businessOwnerId for token-related operations
const userAccessToken = await getUserAccessToken(businessOwnerId);
if (!userAccessToken) {
  console.error(`[ERROR] Could not fetch user access token for Business Owner ID: ${businessOwnerId}`);
  return;
}


    
const businessDetails = await fetchBusinessDetails(businessId);
if (!businessDetails) {
  console.error(`[ERROR] Could not fetch business details for businessId=${businessId}`);
  return;
}
   


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

const { field, value, location } = parseUserMessage(userMessage);

const userInfo = await fetchInstagramUserInfo(senderId, businessId);
if (userInfo) {
  console.log(`[DEBUG] Fetched user info: ${JSON.stringify(userInfo)}`);
  await upsertInstagramUser(senderId, userInfo, businessId, 'customer', location); // Pass location
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
  userInfo?.username || '',
  userInfo?.email || null,
  userInfo?.phone_number || null,
  location // Log location
);



    const assistantResponse = await assistantHandler({
      userMessage,
      businessId,
      field,
      value,
    });

    if (assistantResponse && assistantResponse.message) {
      await respondAndLog(
        businessId,
        senderId,
        recipientId,
        assistantResponse.message,
        igId,
        userInfo?.username || '',
        businessDetails // Pass businessDetails here
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
