// instagramWebhook.js

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
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;

// Rate Limiting Middleware
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});

// Signature Verification Middleware
function verifyFacebookSignature(req, res, buf) {
  const signature = req.headers['x-hub-signature-256'];
  const appSecret = FACEBOOK_APP_SECRET;

  if (!signature) {
    throw new Error('Missing X-Hub-Signature-256 header');
  }

  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', appSecret)
    .update(buf)
    .digest('hex')}`;

  if (signature !== expectedSignature) {
    throw new Error('Invalid signature');
  }
}

// Schema Validation using Joi
const messageSchema = Joi.object({
  sender: Joi.object({
    id: Joi.string().required(),
  }).required(),
  recipient: Joi.object({
    id: Joi.string().required(),
  }).required(),
  timestamp: Joi.number().required(),
  message: Joi.object({
    mid: Joi.string().required(),
    text: Joi.string(),
    is_echo: Joi.boolean(),
    attachments: Joi.array().items(
      Joi.object({
        type: Joi.string().required(),
        payload: Joi.object().required(),
      })
    ),
  }),
  read: Joi.object({
    mid: Joi.string(),
    watermark: Joi.number(),
    seq: Joi.number(),
  }),
  delivery: Joi.object({
    mids: Joi.array().items(Joi.string()),
    watermark: Joi.number(),
    seq: Joi.number(),
  }),
});

/**
 * Send a direct reply to an Instagram user using your Page Access Token.
 * @param {string} recipientId - The Instagram user's ID.
 * @param {string} message - The message to send.
 * @returns {object} - The response from Instagram API.
 */
async function sendInstagramMessage(recipientId, message) {
  try {
    if (!message || typeof message !== 'string') {
      throw new Error('Invalid message content. Cannot send empty or undefined message.');
    }

    console.log(`[DEBUG] Sending message to Instagram user ${recipientId}: "${message}"`);

    if (!PAGE_ACCESS_TOKEN) {
      throw new Error('Missing PAGE_ACCESS_TOKEN environment variable.');
    }

    const response = await fetch(
      `https://graph.facebook.com/v14.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: message },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error sending message to Instagram:', errorText);
      throw new Error(`Failed to send Instagram message: ${response.statusText}`);
    }

    console.log('[DEBUG] Message sent successfully to Instagram user.');
    return await response.json();
  } catch (error) {
    console.error('[ERROR] Failed to send Instagram message:', error);
    throw error;
  }
}

/**
 * Resolve business_id using Instagram Business Account ID.
 * @param {string} instagramId - The Instagram Business Account ID.
 * @returns {number|null} - The internal business ID or null if not found.
 */
async function resolveBusinessIdByInstagramId(instagramId) {
  try {
    const { data: business, error } = await supabase
      .from('businesses')
      .select('id')
      .eq('ig_id', instagramId)
      .single(); // Expects exactly one row

    if (error || !business) {
      console.warn('[WARN] Business not found for Instagram ID:', instagramId);
      return null;
    }

    console.log(`[DEBUG] Resolved business_id: ${business.id} for Instagram ID: ${instagramId}`);
    return business.id;
  } catch (err) {
    console.error('[ERROR] Error while resolving business_id by Instagram ID:', err.message);
    return null;
  }
}

/**
 * Process individual messaging events from the Instagram webhook callback.
 * @param {object} message - The messaging event object.
 */
async function processMessagingEvent(message) {
  try {
    console.log('[DEBUG] Full message object:', JSON.stringify(message, null, 2));

    // Identify the type of event
    if (message.message) {
      // It's a message event
      const userMessage = message.message.text;
      const senderId = message.sender.id;
      const recipientId = message.recipient.id;
      const isEcho = message.message.is_echo || false;

      // Determine message type based on is_echo flag
      const messageType = isEcho ? 'sent' : 'received';

      if (!senderId || !recipientId) {
        console.error('[ERROR] Missing senderId or recipientId.');
        return;
      }

      // Map IDs based on message type
      let businessInstagramId;
      let customerId;
      let targetId; // The ID to send responses to

      if (messageType === 'received') {
        // Message received from customer to business
        businessInstagramId = recipientId; // Instagram business account ID
        customerId = senderId; // Instagram user ID
        targetId = customerId; // Respond to customer
      } else if (messageType === 'sent') {
        // Message sent from business to customer
        businessInstagramId = senderId; // Instagram business account ID
        customerId = recipientId; // Instagram user ID
        targetId = customerId; // Respond to customer
      } else {
        console.warn('[WARN] Unknown message type:', messageType);
        return;
      }

      console.log('[DEBUG] Determined messageType:', messageType);
      console.log('[DEBUG] businessInstagramId:', businessInstagramId);
      console.log('[DEBUG] customerId:', customerId);
      console.log('[DEBUG] targetId:', targetId);

      // Resolve business ID using businessInstagramId
      const businessId = await resolveBusinessIdByInstagramId(businessInstagramId);
      if (!businessId) {
        console.error('[ERROR] Could not resolve business ID.');
        return;
      }

      // Prepare the message content for database insertion
      let messageContent = userMessage || '';
      let messageAttachments = [];

      if (message.message.attachments && Array.isArray(message.message.attachments)) {
        messageAttachments = message.message.attachments.map((attachment) => ({
          type: attachment.type,
          payload: attachment.payload,
        }));
        // Optionally, serialize attachments as a JSON string
        messageContent += ` Attachments: ${JSON.stringify(messageAttachments)}`;
        console.log('[DEBUG] Message contains attachments:', messageAttachments);
      }

      // Insert the conversation into the database
      const { error: conversationError } = await supabase
        .from('instagram_conversations')
        .insert([
          {
            business_id: businessId,
            sender_id: customerId, // Always the customer
            recipient_id: businessInstagramId, // Correctly set to Instagram recipient ID
            message: messageContent, // Include attachments if any
            message_type: messageType,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ]);

      if (conversationError) {
        console.error('[ERROR] Failed to insert Instagram conversation:', conversationError.message);
        throw new Error('Failed to insert Instagram conversation');
      }

      console.log('[DEBUG] Instagram conversation upserted successfully.');

      // If the message is received and contains text, respond using the assistant
      if (messageType === 'received') {
        if (!userMessage) {
          console.warn('[WARN] Received message has no text content.');
          // Optionally, handle messages with attachments here
          return;
        }

        console.log('[DEBUG] Processing message from platform: instagram');
        console.log(`[DEBUG] User message: "${userMessage}"`);

        const assistantResponse = await assistantHandler({
          userMessage,
          businessId,
        });

        if (assistantResponse && assistantResponse.message) {
          await sendInstagramMessage(targetId, assistantResponse.message);
          console.log('[DEBUG] Assistant response sent to customer.');
        } else {
          console.warn('[WARN] Assistant generated no response.');
        }
      }
    } else if (message.read) {
      // It's a read receipt
      console.log('[INFO] Read receipt received:', message.read);
      // Optionally, handle read receipts here
    } else if (message.delivery) {
      // It's a delivery receipt
      console.log('[INFO] Delivery receipt received:', message.delivery);
      // Optionally, handle delivery receipts here
    } else {
      console.warn('[WARN] Unknown messaging event type:', message);
    }
  } catch (error) {
    console.error('[ERROR] Failed to process messaging event:', error.message);
  }
}

/**
 * Webhook verification endpoint (GET)
 */
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Instagram Webhook verified successfully!');
    res.status(200).send(challenge);
  } else {
    console.log('Instagram Webhook verification failed.');
    res.sendStatus(403);
  }
});

/**
 * Fetch Instagram conversations
 */
router.get('/fetch-conversations', async (req, res) => {
  try {
    // Ensure the user is authenticated (optional)
    const { business_id } = req.query; // Get business_id from query parameters or auth middleware

    if (!business_id) {
      return res.status(400).json({ error: 'business_id is required.' });
    }

    // Fetch conversations from the database
    const { data: conversations, error } = await supabase
      .from('instagram_conversations')
      .select(`
        id,
        sender_id,
        recipient_id,
        message,
        created_at,
        customers (
          name,
          phone,
          email,
          location
        )
      `)
      .eq('business_id', business_id)
      .order('created_at', { ascending: false }); // Most recent messages first

    if (error) {
      console.error('[ERROR] Failed to fetch conversations:', error.message);
      return res.status(500).json({ error: 'Failed to fetch conversations.' });
    }

    res.status(200).json({ conversations });
  } catch (err) {
    console.error('[ERROR] Unexpected error fetching conversations:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});




/**
 * Webhook event handler (POST)
 */
router.post(
  '/',
  webhookLimiter,
  express.json({ verify: verifyFacebookSignature }),
  async (req, res) => {
    try {
      const body = req.body;

      if (!body || body.object !== 'instagram') {
        console.error('[ERROR] Invalid webhook object or empty body.');
        return res.status(400).send('Invalid webhook payload.');
      }

      for (const entry of body.entry) {
        console.log('[DEBUG] Processing Instagram entry:', entry);

        if (entry.messaging && Array.isArray(entry.messaging)) {
          for (const message of entry.messaging) {
            // Validate message schema
            const { error } = messageSchema.validate(message);
            if (error) {
              console.error('[ERROR] Invalid message format:', error.details);
              continue; // Skip invalid messages
            }

            await processMessagingEvent(message);
          }
        } else {
          console.warn('[WARN] No messaging events found in Instagram entry.');
        }
      }

      res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      console.error('[ERROR] Failed to process webhook events:', error.message);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

export default router;
