// webhook.js

import express from 'express';
import fetch from 'node-fetch';
import supabase from './supabaseClient.js';
import assistantHandler from './assistant.js';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import Joi from 'joi';

const router = express.Router();

// Environment Variables
const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;

if (!VERIFY_TOKEN || !FACEBOOK_APP_SECRET) {
  console.error('[ERROR] Missing required environment variables.');
  throw new Error('Environment variables missing. Cannot start server.');
}

// Rate Limiting Middleware
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
});

// Signature Verification Middleware
function verifyFacebookSignature(req, res, buf) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) throw new Error('Missing X-Hub-Signature-256 header');

  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', FACEBOOK_APP_SECRET)
    .update(buf)
    .digest('hex')}`;

  if (signature !== expectedSignature) throw new Error('Invalid signature');
}

// Apply middleware for POST requests
router.use('/', webhookLimiter, express.json({ verify: verifyFacebookSignature }));

// Joi Schema Validation for Messages
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

/**
 * Fetch business details (ig_id and page_id) for a given businessId.
 */
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

/**
 * Fetch the ig_id for a given businessId from Supabase.
 */
async function fetchInstagramId(pageId, pageAccessToken) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v15.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
    );
    const data = await response.json();
    console.log('[DEBUG] fetchInstagramId Response:', data);

    if (response.ok && data.instagram_business_account) {
      console.log(`[INFO] Instagram Business Account ID: ${data.instagram_business_account.id}`);
      return data.instagram_business_account.id;
    }
    console.warn(`[WARN] No Instagram Business Account linked to Page ID: ${pageId}`);
    return null;
  } catch (err) {
    console.error('[ERROR] Failed to fetch Instagram Business Account ID:', err.message);
    return null;
  }
}

async function getPageAccessToken(businessId, pageId) {
  try {
    const { data, error } = await supabase
      .from('page_access_tokens')
      .select('page_access_token')
      .eq('business_id', businessId)
      .eq('page_id', pageId)
      .single();

    if (error || !data) {
      console.error('[ERROR] Failed to fetch page access token:', error?.message || 'No data found');
      return null;
    }

    console.log(`[INFO] Page Access Token for businessId=${businessId}, pageId=${pageId}: ${data.page_access_token}`);
    return data.page_access_token;
  } catch (err) {
    console.error('[ERROR] Exception while fetching page access token:', err.message);
    return null;
  }
}


/**
 * Resolve a business ID by matching an incoming Instagram ID (object ID).
 */
async function resolveBusinessIdByInstagramId(instagramId) {
  try {
    console.log('[DEBUG] Received Instagram ID for resolution:', instagramId);

    const { data: business, error } = await supabase
      .from('businesses')
      .select('id, ig_id')
      .eq('ig_id', instagramId)
      .maybeSingle();

    if (error) {
      console.error('[ERROR] Supabase query failed:', error.message);
      return null;
    }

    if (!business) {
      console.warn('[WARN] No business found for Instagram ID:', instagramId);
      return null;
    }

    const businessInstagramId = business.ig_id;
    console.log(`[DEBUG] Resolved business ID: ${business.id} for Instagram ID: ${businessInstagramId}`);
    return business.id;
  } catch (err) {
    console.error('[ERROR] Exception in resolveBusinessIdByInstagramId:', err.message);
    return null;
  }
}

/**
 * Log a received or sent message to the 'instagram_conversations' table.
 */
async function logMessage(businessId, senderId, recipientId, message, type, mid, isBusinessMessage, igIdFromDB, senderName) {
  try {
    const validMessageId = typeof mid === 'string' ? mid : null;

    const { error } = await supabase
      .from('instagram_conversations')
      .insert([
        {
          business_id: businessId,
          sender_id: senderId,
          recipient_id: recipientId,
          message,
          message_type: type,
          message_id: validMessageId,
          role: isBusinessMessage ? 'business' : 'customer',
          ig_id: igIdFromDB,
          sender_name: senderName,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

    if (error) {
      console.error('[ERROR] Failed to log message:', error.message);
      throw new Error(error.message);
    }
    console.log(`[INFO] Message logged successfully for business ${businessId}`);
  } catch (err) {
    console.error('[ERROR] Failed to log message:', err.message);
  }
}

/**
 * Core function that processes each messaging event from the Instagram webhook.
 */
async function processMessagingEvent(message) {
  try {
    console.log('[DEBUG] Incoming message payload:', JSON.stringify(message, null, 2));

    const senderId = message.sender.id;
    const recipientId = message.recipient.id;

    if (!senderId || !recipientId) {
      console.error('[ERROR] senderId or recipientId is missing in message payload.');
      return;
    }

    const isDeleted = message.message?.is_deleted || false;
    console.log(`[DEBUG] Message is_deleted: ${isDeleted}`);
    const isEcho = message.message?.is_echo || false;
    const userMessage = message.message?.text || '';
    const messageId = message.message?.mid;

    const businessInstagramId = isEcho ? senderId : recipientId;
    const businessId = await resolveBusinessIdByInstagramId(businessInstagramId);

    if (!businessId) {
      console.error('[ERROR] Could not resolve businessId for Instagram ID:', businessInstagramId);
      return;
    }
    console.log(`[DEBUG] Resolved business ID: ${businessId}`);

    // Fetch business details including ig_id and page_id
    const businessDetails = await fetchBusinessDetails(businessId);
    if (!businessDetails) {
      console.error('[ERROR] Could not fetch business details.');
      return;
    }

    const { ig_id: businessIgId, page_id: pageId } = businessDetails;

    // Fetch dynamic page access token
    console.log(`[DEBUG] Fetching page access token for businessId=${businessId}, pageId=${pageId}`);
    const pageAccessToken = await getPageAccessToken(businessId, pageId);
    if (!pageAccessToken) {
      console.error('[ERROR] Page access token is missing or invalid for business ID:', businessId);
      return;
    }

    if (isDeleted) {
      console.log('[INFO] Handling deleted message event.');
      if (!messageId) {
        console.error('[WARN] Deleted message has no valid message ID.');
        return;
      }
      console.log(`[DEBUG] Deleting message with ID: ${messageId}`);
      await handleUnsentMessage(messageId, businessId);
      console.log('[INFO] Deleted message handled.');
      return;
    }

    if (isEcho) {
      console.log('[INFO] Ignoring echo message.');
      return;
    }

    if (!userMessage.trim()) {
      console.log('[INFO] Skipping response for empty or missing message.');
      return;
    }

    const igIdFromDB = await fetchBusinessInstagramId(businessId);
    if (!igIdFromDB) {
      console.error('[ERROR] Could not fetch ig_id for businessId:', businessId);
      return;
    }

    // Fetch Instagram user info and validate
    const userInfo = await fetchInstagramUserInfo(senderId, businessId, pageId, pageAccessToken);
    if (!userInfo) {
      console.warn(`[WARN] Skipping user upsert as userInfo could not be fetched for senderId=${senderId}`);
      return; // Skip further processing for invalid senderId
    }

    // Ensure the user exists in the database
    await upsertInstagramUser(senderId, businessId);

    // Determine user role: 'business' or 'customer'
    const isBusinessMessage = senderId === businessIgId;
    const role = isBusinessMessage ? 'business' : 'customer';
    console.log(`[INFO] Identified role: ${role}`);

    // Log the received message in the database
    await logMessage(
      businessId,
      senderId,
      recipientId,
      userMessage,
      'received',
      messageId,
      isBusinessMessage,
      igIdFromDB,
      userInfo?.username || ''
    );

    // Generate AI response
    console.log('[DEBUG] Generating AI response...');
    const assistantResponse = await assistantHandler({ userMessage, businessId });

    if (assistantResponse && assistantResponse.message) {
      console.log(`[DEBUG] AI Response: ${assistantResponse.message}`);
      await sendInstagramMessage(senderId, assistantResponse.message, businessId, pageId, pageAccessToken);
      await logMessage(
        businessId,
        senderId,
        recipientId,
        assistantResponse.message,
        'sent',
        null,
        true, // isBusinessMessage is true since it's sent by the business
        igIdFromDB,
        'Business'
      );
    }
  } catch (err) {
    console.error('[ERROR] Failed to process messaging event:', err.message);
  }
}

/**
 * Main webhook POST route for processing Instagram messages and other events.
 */
router.post('/', async (req, res) => {
  try {
    const payload = req.body;

    console.log('[DEBUG] Incoming webhook payload:', JSON.stringify(payload, null, 2));

    if (!payload || !payload.entry) {
      console.error('[ERROR] Invalid webhook payload: Missing entry data');
      return res.status(400).send('Invalid payload');
    }

    const { object, entry } = payload;

    if (object === 'instagram') {
      console.log('[INFO] Handling Instagram messaging event:', entry);
      for (const event of entry) {
        if (event.messaging) {
          for (const messageEvent of event.messaging) {
            const { error } = messageSchema.validate(messageEvent);
            if (error) {
              console.error('[ERROR] Invalid message format:', error.details[0].message);
              continue; // Skip invalid messages
            }

            await processMessagingEvent(messageEvent);
          }
        } else {
          console.warn('[WARN] Unsupported Instagram event type:', JSON.stringify(event, null, 2));
        }
      }
      return res.status(200).send('Instagram messaging handled');
    }

    console.warn('[WARN] Unhandled webhook object type:', object);
    return res.status(400).send('Unhandled object type');
  } catch (error) {
    console.error('[ERROR] Failed to process webhook:', error.message);
    return res.status(500).send('Webhook processing failed');
  }
});

/**
 * Webhook verification endpoint (GET).
 */
router.get('/', (req, res) => {
  const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN;

  console.log('[DEBUG] Webhook verification query:', req.query);

  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    console.log('[INFO] Webhook verified');
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.warn('[WARN] Webhook verification failed');
    res.status(403).send('Verification failed');
  }
});

export default router;
