import express from 'express';
import fetch from 'node-fetch';
import supabase from './supabaseClient.js';
import assistantHandler from './assistant.js';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import Joi from 'joi';
import {
  fetchInstagramIdFromDatabase,
  fetchInstagramIdFromFacebook,
  fetchInstagramUserInfo,
  logMessage,
  parseUserMessage,
  fetchBusinessDetails,
} from './helpers.js';
import { refreshPageAccessToken } from './auth/refresh-token.js';

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
  windowMs: 15 * 60 * 1000,
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

// Joi schema for message validation
const messageSchema = Joi.object({
  sender: Joi.object({ id: Joi.string().required() }).required(),
  recipient: Joi.object({ id: Joi.string().required() }).required(),
  timestamp: Joi.number().required(),
  message: Joi.object({
    mid: Joi.string().required(),
    text: Joi.string().allow(null),
    is_deleted: Joi.boolean().optional(),
    is_echo: Joi.boolean().optional(),
    read: Joi.object().unknown(true).optional(),
    attachments: Joi.array().items(
      Joi.object({
        type: Joi.string().required(),
        payload: Joi.object().required(),
      })
    ).optional(),
  }).unknown(true),
});

// Helper to fetch business details from Supabase
async function fetchBusinessDetails(businessId) {
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('ig_id, page_id')
      .eq('id', businessId)
      .single();

    if (error || !data) {
      console.error(`[ERROR] Failed to fetch business details for businessId=${businessId}:`, error?.message || 'No data found');
      return null;
    }
    return { ig_id: data.ig_id, page_id: data.page_id };
  } catch (err) {
    console.error('[ERROR] Exception while fetching business details:', err.message);
    return null;
  }
}

// Helper to get page access token from Supabase
async function getPageAccessToken(businessId, pageId, supabase) {
  try {
    const { data, error } = await supabase
      .from('pages')
      .select('page_access_token, user_access_token')
      .eq('business_id', businessId)
      .eq('page_id', pageId)
      .single();

    if (error || !data) {
      console.error(`[ERROR] Failed to fetch access token for businessId=${businessId}, pageId=${pageId}:`, error?.message || 'No data found');
      return null;
    }

    let { page_access_token: pageAccessToken, user_access_token: userAccessToken } = data;

    // Validate token by making a test API call
    const testResponse = await fetch(`https://graph.facebook.com/v15.0/me?access_token=${pageAccessToken}`);
    const testData = await testResponse.json();

    if (testData.error?.message.includes('Session has expired')) {
      console.warn(`[WARN] Access token expired for pageId=${pageId}. Refreshing token...`);
      pageAccessToken = await refreshPageAccessToken(pageId, userAccessToken);

      if (!pageAccessToken) {
        console.error(`[ERROR] Failed to refresh access token for pageId=${pageId}`);
        return null;
      }
    }

    return pageAccessToken;
  } catch (err) {
    console.error(`[ERROR] Exception while fetching access token for pageId=${pageId}:`, err.message);
    return null;
  }
}

export { getPageAccessToken };

async function fetchBusinessIdFromInstagramId(igId, supabase) {
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
async function processMessagingEvent(message) {
  try {
    console.log('[DEBUG] Incoming message payload:', JSON.stringify(message, null, 2));

    // Extract sender and recipient IDs
    const senderId = message.sender.id;
    const recipientId = message.recipient.id;

    if (!senderId || !recipientId) {
      console.error('[ERROR] senderId or recipientId is missing in message payload.');
      return;
    }

    // Determine message attributes
    const isDeleted = message.message?.is_deleted || false;
    console.log(`[DEBUG] Message is_deleted: ${isDeleted}`);
    const isEcho = message.message?.is_echo || false;
    const userMessage = message.message?.text || '';
    const messageId = message.message?.mid;

    // Determine the appropriate Instagram ID
    const igId = isEcho ? senderId : recipientId;
    console.log(`[DEBUG] Using Instagram ID: ${igId}`);

    // Fetch businessId using Instagram ID
    const businessId = await fetchBusinessIdFromInstagramId(igId, supabase);
    if (!businessId) {
      console.error('[ERROR] Could not resolve businessId for Instagram ID:', igId);
      return;
    }
    console.log(`[DEBUG] Resolved business ID: ${businessId}`);

    // Handle deleted messages
    if (isDeleted) {
      console.log('[INFO] Handling deleted message event...');
      if (!messageId) {
        console.error('[WARN] Deleted message does not have a valid message ID.');
        return;
      }
      console.log(`[DEBUG] Deleting message with ID: ${messageId}`);
      await handleUnsentMessage(messageId, businessId);
      console.log('[INFO] Deleted message handled successfully.');
      return;
    }

    // Ignore echo messages
    if (isEcho) {
      console.log('[INFO] Ignoring echo message.');
      return;
    }

    // Skip empty or whitespace-only messages
    if (!userMessage.trim()) {
      console.log('[INFO] Skipping empty or missing message.');
      return;
    }

    // Fetch Instagram user information dynamically
    const userInfo = await fetchInstagramUserInfo(senderId, businessId, supabase);
    if (!userInfo) {
      console.warn(`[WARN] Could not fetch user info for senderId=${senderId}.`);
    } else {
      console.log(`[DEBUG] Fetched user info: ${JSON.stringify(userInfo)}`);
    }

    // Log the incoming message
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

    // Parse user message and update user profile if applicable
    const { field, value } = parseUserMessage(userMessage);
    if (field && value) {
      console.log(`[INFO] Updating user info for senderId=${senderId}, field=${field}, value=${value}`);
      await updateInstagramUserInfo(senderId, businessId, field, value);
    }

    // Generate an AI response
    console.log('[DEBUG] Generating AI response...');
    const assistantResponse = await assistantHandler({ userMessage, businessId });

    // Send AI response if generated
    if (assistantResponse && assistantResponse.message) {
      console.log(`[DEBUG] AI Response: ${assistantResponse.message}`);
      await sendInstagramMessage(senderId, assistantResponse.message);
      await logMessage(
        businessId,
        senderId,
        recipientId,
        assistantResponse.message,
        'sent',
        null,
        true, // isBusinessMessage
        igId,
        'Business'
      );
    }
  } catch (err) {
    console.error('[ERROR] Failed to process messaging event:', err.message);
  }
}



// POST route for webhook
router.post('/', async (req, res) => {
  try {
    const payload = req.body;

    if (!payload || !payload.entry) {
      return res.status(400).send('Invalid payload');
    }

    const { object, entry } = payload;
    if (object === 'instagram') {
      for (const event of entry) {
        if (event.messaging) {
          for (const messageEvent of event.messaging) {
            const { error } = messageSchema.validate(messageEvent);
            if (error) {
              console.error('[ERROR] Invalid message format:', error.details);
              continue; // Skip invalid messages
            }
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
