import express from 'express';
import fetch from 'node-fetch';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import supabase from './supabaseClient.js';
import assistantHandler from './assistant.js';
import {
  fetchInstagramIdFromDatabase,
  fetchInstagramUserInfo,
  logMessage,
  parseUserMessage,
  fetchBusinessDetails,
  getPageAccessToken,
  sendInstagramMessage,
  upsertInstagramUser,
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
      .from('businesses') // Updated table name
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

    // Determine message attributes
    const isDeleted = messageEvent.message?.is_deleted || false;
    console.log(`[DEBUG] Message is_deleted: ${isDeleted}`);
    const isEcho = messageEvent.message?.is_echo || false;
    const userMessage = messageEvent.message?.text || '';
    const messageId = messageEvent.message?.mid;

    // Determine the appropriate Instagram ID
    const igId = isEcho ? senderId : recipientId;
    console.log(`[DEBUG] Using Instagram ID: ${igId}`);

    // Fetch business ID using Instagram ID
    const businessId = await fetchBusinessIdFromInstagramId(igId);
    if (!businessId) {
      console.error('[ERROR] Could not resolve businessId for Instagram ID:', igId);
      return;
    }
    console.log(`[DEBUG] Resolved business ID: ${businessId}`);

    const businessDetails = await fetchBusinessDetails(businessId);
    if (!businessDetails) {
      console.error(`[ERROR] Could not fetch business details for businessId=${businessId}`);
      return;
    }

    const { business_owner_id } = businessDetails;
    if (!business_owner_id) {
      console.error(`[ERROR] No associated business_owner_id for businessId=${businessId}`);
      return;
    }

    console.log(`[DEBUG] Using business_owner_id=${business_owner_id} for processing.`);




    
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
    const userInfo = await fetchInstagramUserInfo(senderId, businessId);
    if (userInfo) {
      console.log(`[DEBUG] Fetched user info: ${JSON.stringify(userInfo)}`);
      await upsertInstagramUser(senderId, userInfo, businessId);
    } else {
      console.warn(`[WARN] Could not fetch user info for senderId=${senderId}.`);
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

      // Fetch the access token dynamically
      const businessDetails = await fetchBusinessDetails(businessId);
      if (!businessDetails) {
        console.error(`[ERROR] Could not fetch business details for businessId=${businessId}`);
        return;
      }

      const { page_id: pageId } = businessDetails;
      const accessToken = await getPageAccessToken(businessId, pageId);
      if (!accessToken) {
        console.error('[ERROR] Failed to fetch access token. Cannot send message.');
        return;
      }

      // Send the AI response
      await sendInstagramMessage(senderId, assistantResponse.message, accessToken);

      // Log the outgoing message
      await logMessage(
        businessId,
        senderId,
        recipientId,
        assistantResponse.message,
        'sent',
        null, // No messageId for outgoing messages
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
    if (!payload || !payload.entry) return res.status(400).send('Invalid payload');

    const { object, entry } = payload;
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
