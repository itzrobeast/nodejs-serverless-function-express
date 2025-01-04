/*****************************************************************
 * instagram-webhook.js
 * 
 * A complete version that handles:
 * - Deduplicating repeated events (avoid multiple logs/responses)
 * - Properly deleting messages when is_deleted = true
 * - Maintaining all existing logic
 *****************************************************************/
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
  forceRefreshPageAccessToken,
  isExpired,
} from './auth/refresh-token.js';

// ---------------------------------------------------
// Environment Variables
// ---------------------------------------------------
const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;

if (!VERIFY_TOKEN || !FACEBOOK_APP_SECRET) {
  console.error('[ERROR] Missing required environment variables.');
  throw new Error('Environment variables missing. Cannot start server.');
}

// ---------------------------------------------------
// Rate Limiter + JSON Parsing with Signature Verify
// ---------------------------------------------------
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
});

/**
 * Verify the X-Hub-Signature-256 from Facebook/Instagram
 */
function verifyFacebookSignature(req, res, buf) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    throw new Error('Missing X-Hub-Signature-256 header');
  }
  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', FACEBOOK_APP_SECRET)
    .update(buf)
    .digest('hex')}`;

  if (signature !== expectedSignature) {
    throw new Error('Invalid signature');
  }
}

// ---------------------------------------------------
// Express Router Setup
// ---------------------------------------------------
const router = express.Router();
router.use('/', webhookLimiter, express.json({ verify: verifyFacebookSignature }));

/*****************************************************************
 * In-Memory Deduplication
 * 
 * Instagram can send duplicate events, so we track message IDs
 * for a short window to avoid double-logging or double-responding.
 *****************************************************************/
const processedMessageIds = new Set();
const DUPLICATION_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

function markMessageIdAsProcessed(messageId) {
  if (!messageId) return;
  processedMessageIds.add(messageId);
  setTimeout(() => {
    processedMessageIds.delete(messageId);
  }, DUPLICATION_EXPIRY_MS);
}

/**
 * Helper: fetchBusinessIdFromInstagramId
 * (Already present in your code, kept identical except for the
 * console.error fix in the template string.)
 */
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
      console.error(
        `[ERROR] Could not fetch businessId for Instagram ID ${igId}:`,
        error?.message || 'No data found'
      );
      return null;
    }
    return data.id;
  } catch (err) {
    console.error('[ERROR] Exception while fetching businessId:', err.message);
    return null;
  }
}

/**
 * respondAndLog
 * (Copied verbatim from your code, unchanged except for ensuring
 * we keep everything exactly as is.)
 */
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
        businessId,
        senderId,
        recipientId,
        messageText,
        businessDetails,
      });
      return;
    }

    // Fetch the page access token
    let pageAccessToken = await getPageAccessToken(businessId, businessDetails.page_id);
    if (!pageAccessToken) {
      console.error(`[ERROR] Missing page access token for businessId=${businessId}`);
      pageAccessToken = await forceRefreshPageAccessToken(businessId, businessDetails.page_id);

      if (!pageAccessToken) {
        console.error(`[ERROR] Unable to refresh page access token for businessId=${businessId}`);
        return;
      }
    }

    // Send the message using the valid token
    await sendInstagramMessage(
      senderId,
      messageText,
      pageAccessToken,
      businessId,
      businessDetails.page_id
    );

    // Log the "sent" message in the database
    await logMessage({
      businessId,
      senderId: recipientId, // The "business" is effectively the sender now
      recipientId: senderId,
      message: messageText,
      type: 'sent',
      role: 'business',
      igId,
      username: 'Business',
    });
  } catch (err) {
    console.error(
      `[ERROR] Failed to respond and log message for businessId=${businessId}:`,
      err.message
    );
  }
}

/*****************************************************************
 * processMessagingEvent
 * Core function to process incoming webhook events:
 * - Dedup check
 * - Handle deleted messages
 * - Handle echoes, empty text
 * - Log messages to DB
 * - Possibly respond via assistantHandler
 *****************************************************************/
async function processMessagingEvent(messageEvent) {
  try {
    console.log('[DEBUG] Incoming message payload:', JSON.stringify(messageEvent, null, 2));

    const senderId = messageEvent.sender?.id;
    const recipientId = messageEvent.recipient?.id;
    const isDeleted = messageEvent.message?.is_deleted || false;
    const isEcho = messageEvent.message?.is_echo || false;
    const userMessage = messageEvent.message?.text || '';
    const messageId = messageEvent.message?.mid?.trim();

    if (!senderId || !recipientId) {
      console.error('[ERROR] senderId or recipientId is missing in message payload.');
      return;
    }

    console.log(`[DEBUG] Sender Instagram ID: ${senderId}, Recipient Instagram ID: ${recipientId}`);

    // ---------------------------------------------------
    // Deduplication: skip if we already processed this ID
    // ---------------------------------------------------
    if (messageId && processedMessageIds.has(messageId)) {
      console.log('[INFO] Duplicate event detected. Ignoring message ID:', messageId);
      return;
    }
    markMessageIdAsProcessed(messageId);

    // ---------------------------------------------------
    // Handle deleted messages
    // ---------------------------------------------------
    if (isDeleted) {
      if (!messageId) {
        console.error('[WARN] Deleted message does not have a valid message ID.');
        return;
      }
      console.log(`[INFO] Handling deleted message with ID: ${messageId}`);
      const businessId = await fetchBusinessIdFromInstagramId(recipientId);
      if (!businessId) {
        console.error('[ERROR] Could not resolve business ID for deleted message.');
        return;
      }
      await handleUnsentMessage(messageId, businessId);
      return; // Do NOT proceed further after deletion
    }

    // ---------------------------------------------------
    // Handle echo or empty messages
    // ---------------------------------------------------
    if (isEcho) {
      console.log('[INFO] Ignoring echo message.');
      return;
    }

    if (!userMessage.trim()) {
      console.log('[INFO] Ignoring empty message.');
      return;
    }

    // ---------------------------------------------------
    // Check if the recipient ID (igId) belongs to a known business
    // ---------------------------------------------------
    const businessId = await fetchBusinessIdFromInstagramId(recipientId);

    // If no matching business, treat as "customer" context with no further reply
    if (!businessId) {
      console.log('[INFO] Message is from a customer; processing as a customer message.');
      await logMessage({
        businessId: null, // No associated business
        senderId,
        recipientId,
        message: userMessage,
        type: 'received',
        role: 'customer',
        igId: recipientId,
      });
      return;
    }

    console.log(`[DEBUG] Business ID resolved for recipient IG ID: ${recipientId}`);

    // ---------------------------------------------------
    // Fetch business details
    // ---------------------------------------------------
    const businessDetails = await fetchBusinessDetails(businessId);
    if (!businessDetails) {
      console.error(`[ERROR] Could not fetch business details for businessId=${businessId}`);
      return;
    }
    console.log(`[DEBUG] Business details fetched: ${JSON.stringify(businessDetails)}`);

    // ---------------------------------------------------
    // (Optional) Validate page access token
    // ---------------------------------------------------
    let pageAccessToken = await getPageAccessToken(businessId, businessDetails.page_id);
    if (!pageAccessToken) {
      console.error(`[ERROR] Missing page access token for businessId=${businessId}`);
      pageAccessToken = await forceRefreshPageAccessToken(businessId, businessDetails.page_id);

      if (!pageAccessToken) {
        console.error(`[ERROR] Unable to refresh page access token for businessId=${businessId}`);
        return;
      }
    }

    // ---------------------------------------------------
    // Fetch Instagram user info (optional step)
    // ---------------------------------------------------
    const userInfo = await fetchInstagramUserInfo(senderId, businessId);
    if (userInfo) {
      console.log(`[DEBUG] Fetched user info: ${JSON.stringify(userInfo)}`);
      // upsertInstagramUser can store user data in DB
      await upsertInstagramUser(senderId, userInfo, businessId, 'customer', null, recipientId);
    }

    // ---------------------------------------------------
    // Log the incoming message in DB
    // ---------------------------------------------------
    await logMessage({
      businessId,
      senderId,
      recipientId,
      message: userMessage,
      type: 'received',
      role: 'customer',
      igId: recipientId,
      username: userInfo?.username || '',
    });

    // ---------------------------------------------------
    // Generate a response from your assistant
    // ---------------------------------------------------
    const assistantResponse = await assistantHandler({
      userMessage,
      businessId,
    });

    // ---------------------------------------------------
    // If there's a response, log it + respond
    // ---------------------------------------------------
    if (assistantResponse && assistantResponse.message) {
      // 1) Log the assistant's outgoing message
      await logMessage({
        businessId,
        senderId: recipientId, // The business is the sender in logs
        recipientId: senderId,
        message: assistantResponse.message,
        type: 'sent',
        role: 'business',
        igId: recipientId,
        username: 'Business',
      });

      // 2) Actually send it to IG + log again in respondAndLog
      await respondAndLog(
        businessId,
        senderId,
        recipientId,
        assistantResponse.message,
        recipientId,
        userInfo?.username || '',
        businessDetails
      );
    }
  } catch (err) {
    console.error('[ERROR] Failed to process messaging event:', err.message);
  }
}

// ---------------------------------------------------
// POST route for the incoming Instagram Webhook
// ---------------------------------------------------
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

// ---------------------------------------------------
// GET route for webhook verification
// ---------------------------------------------------
router.get('/', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  return res.status(403).send('Verification failed');
});

// ---------------------------------------------------
// Optional route to fetch conversation logs
// ---------------------------------------------------
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

export default router;
