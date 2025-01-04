/*****************************************************************
 * instagram-webhook.js
 *
 * A version that:
 * - Removes in-memory deduplication logic
 * - Still handles deleted messages (is_deleted)
 * - Maintains DB-level checks for duplicates (if any)
 * - Logs messages in the DB
 * - Invokes assistantHandler and responds
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

/**
 * Helper to fetch business ID from an Instagram ID.
 */
async function fetchBusinessIdFromInstagramId(igId) {
  if (!igId || isNaN(Number(igId))) {
    console.error('[ERROR] Invalid or missing ig_id:', igId);
    return null;
  }
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('id')
      .eq('ig_id', igId)
      .single();

    if (error || !data) {
      console.error('[ERROR] Could not fetch businessId for Instagram ID', igId, error?.message || 'No data found');
      return null;
    }
    return data.id;
  } catch (err) {
    console.error('[ERROR] Exception while fetching businessId:', err.message);
    return null;
  }
}

/**
 * Send a response message to the user and log it as "sent" by the business.
 * Checks the DB for duplicates, but no in-memory dedup.
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
    // Check if we already logged this outgoing message
    const { data: existingMessage, error: fetchError } = await supabase
      .from('instagram_conversations')
      .select('id')
      .eq('business_id', businessId)
      .eq('sender_id', recipientId) // The "business" is effectively the sender
      .eq('recipient_id', senderId)
      .eq('message', messageText)
      .eq('message_type', 'sent')
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('[ERROR] Checking for duplicate response failed:', fetchError.message);
      return;
    }

    if (existingMessage) {
      console.log('[INFO] Duplicate response found. Skipping send.');
      return;
    }

    let pageAccessToken = await getPageAccessToken(businessId, businessDetails.page_id);
    if (!pageAccessToken) {
      console.error('[ERROR] Missing page access token for businessId=', businessId);
      pageAccessToken = await forceRefreshPageAccessToken(businessId, businessDetails.page_id);
      if (!pageAccessToken) {
        console.error('[ERROR] Could not refresh page access token for businessId=', businessId);
        return;
      }
    }

    // Actually send the message
    await sendInstagramMessage(
      senderId,
      messageText,
      pageAccessToken,
      businessId,
      businessDetails.page_id
    );

    // Log as "sent"
    await logMessage({
      businessId,
      senderId: recipientId, // The "business" is effectively the sender
      recipientId: senderId,
      message: messageText,
      type: 'sent',
      role: 'business',
      igId,
      username: 'Business',
    });
  } catch (err) {
    console.error(`[ERROR] respondAndLog failed for businessId=${businessId}:`, err.message);
  }
}

/**
 * Main function to process incoming messages:
 * - Checks for deleted messages
 * - Ignores echo or empty
 * - Logs to DB
 * - Possibly calls assistantHandler
 * - Sends the response
 */
async function processMessagingEvent(messageEvent) {
  try {
    console.log('[DEBUG] Incoming message payload:', JSON.stringify(messageEvent, null, 2));

    const senderId = messageEvent.sender?.id;
    const recipientId = messageEvent.recipient?.id;
    const isDeleted = !!messageEvent.message?.is_deleted;
    const isEcho = !!messageEvent.message?.is_echo;
    const userMessage = messageEvent.message?.text || '';
    const messageId = messageEvent.message?.mid?.trim();

    if (!senderId || !recipientId) {
      console.error('[ERROR] Missing senderId or recipientId in message payload.');
      return;
    }

    // Handle deleted messages early
    if (isDeleted) {
      if (!messageId) {
        console.warn('[WARN] Deleted message has no valid message ID.');
        return;
      }
      console.log('[INFO] Handling deleted message with ID:', messageId);
      const businessId = await fetchBusinessIdFromInstagramId(recipientId);
      if (!businessId) {
        console.error('[ERROR] Could not resolve businessId for deleted message.');
        return;
      }
      await handleUnsentMessage(messageId, businessId);
      return;
    }

    // Ignore echo or empty text
    if (isEcho) {
      console.log('[INFO] Ignoring echo message.');
      return;
    }
    if (!userMessage.trim()) {
      console.log('[INFO] Ignoring empty message.');
      return;
    }

    // Determine if recipientId is the IG ID of a known business
    const businessId = await fetchBusinessIdFromInstagramId(recipientId);
    if (!businessId) {
      console.log('[INFO] No matching business found; logging as customer message only.');
      // Just log as a "received" message with no business
      await logMessage({
        businessId: null,
        senderId,
        recipientId,
        message: userMessage,
        type: 'received',
        role: 'customer',
        igId: recipientId,
      });
      return;
    }

    // If found, fetch business details
    const businessDetails = await fetchBusinessDetails(businessId);
    if (!businessDetails) {
      console.error('[ERROR] Could not fetch details for businessId=', businessId);
      return;
    }

    // (Optional) fetch page access token in case we need it
    let pageAccessToken = await getPageAccessToken(businessId, businessDetails.page_id);
    if (!pageAccessToken) {
      console.error('[ERROR] Missing page access token for businessId=', businessId);
      pageAccessToken = await forceRefreshPageAccessToken(businessId, businessDetails.page_id);
      if (!pageAccessToken) {
        console.error('[ERROR] Could not refresh page access token for businessId=', businessId);
        return;
      }
    }

    // (Optional) fetch user info from Graph
    const userInfo = await fetchInstagramUserInfo(senderId, businessId);
    if (userInfo) {
      console.log('[DEBUG] Fetched user info:', JSON.stringify(userInfo));
      // Upsert user record
      await upsertInstagramUser(senderId, userInfo, businessId, 'customer', null, recipientId);
    }

    // Log the incoming "received" message
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

    // Call the assistant to generate a response
    console.log('[DEBUG] Invoking assistantHandler with:', { userMessage, businessId });
    const assistantResponse = await assistantHandler({ userMessage, businessId });
    console.log('[DEBUG] Assistant response:', assistantResponse);

    // If there's a message in the response, log it + respond
    if (assistantResponse?.message) {
      // 1) Log as "sent" by the business
      await logMessage({
        businessId,
        senderId: recipientId, // "business" is the sender
        recipientId: senderId,
        message: assistantResponse.message,
        type: 'sent',
        role: 'business',
        igId: recipientId,
        username: 'Business',
      });

      // 2) Actually send to Instagram + log again in respondAndLog
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
    console.error('[ERROR] processMessagingEvent failed:', err.message);
  }
}

// POST route for your Instagram Webhook
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

// GET route for webhook verification
router.get('/', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  return res.status(403).send('Verification failed');
});

// Optional route to fetch conversation logs
router.get('/fetch-conversations', async (req, res) => {
  try {
    const { business_id } = req.query;
    if (!business_id) {
      return res.status(400).json({ error: 'Missing required parameter: business_id' });
    }

    console.log('[INFO] Fetching conversations for business_id=', business_id);
    const { data, error } = await supabase
      .from('instagram_conversations')
      .select('*')
      .eq('business_id', business_id);

    if (error) {
      console.error('[ERROR] Failed to fetch conversations for business_id=', business_id, error.message);
      return res.status(500).json({ error: 'Failed to fetch conversations' });
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error('[ERROR] Exception while fetching conversations:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
