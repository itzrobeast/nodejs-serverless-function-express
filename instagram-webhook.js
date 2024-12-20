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

// Check for required environment variables
if (!VERIFY_TOKEN || !PAGE_ACCESS_TOKEN || !FACEBOOK_APP_SECRET) {
  console.error('[ERROR] Missing required environment variables.');
  process.exit(1);
}

// Rate Limiting Middleware
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
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

// Joi Schema Validation for Messages
const messageSchema = Joi.object({
  sender: Joi.object({ id: Joi.string().required() }).required(),
  recipient: Joi.object({ id: Joi.string().required() }).required(),
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
});

// Helper Function to Check Partition Existence
async function doesPartitionExist(partitionName) {
  try {
    const { data, error } = await supabase.rpc('check_partition_exists', {
      partition_name: partitionName,
    });

    if (error) {
      console.error(`[ERROR] Supabase RPC call failed: ${error.message}`);
      return false;
    }

    return data[0]?.partition_exists || false;
  } catch (err) {
    console.error('[ERROR] Failed to check partition existence:', err.message);
    return false;
  }
}

// Helper Function to Send Instagram Messages
async function sendInstagramMessage(recipientId, message) {
  try {
    if (!message || typeof message !== 'string') {
      throw new Error('Invalid message content.');
    }
    console.log(`[DEBUG] Sending message to Instagram user ${recipientId}: "${message}"`);
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
      throw new Error(`Failed to send message: ${errorText}`);
    }
    console.log('[DEBUG] Message sent successfully to Instagram user.');
    return await response.json();
  } catch (error) {
    console.error('[ERROR] Failed to send Instagram message:', error.message);
    throw error;
  }
}

// Helper Function to Resolve Business ID
async function resolveBusinessIdByInstagramId(instagramId) {
  try {
    const { data: business, error } = await supabase
      .from('businesses')
      .select('id')
      .eq('ig_id', instagramId)
      .single();

    if (error || !business) {
      console.warn('[WARN] Business not found for Instagram ID:', instagramId);
      return null;
    }
    return business.id;
  } catch (err) {
    console.error('[ERROR] Error resolving business ID:', err.message);
    return null;
  }
}

// Process Individual Messaging Events
async function processMessagingEvent(message) {
  try {
    console.log('[DEBUG] Processing message:', JSON.stringify(message, null, 2));

    const senderId = message.sender.id;
    const recipientId = message.recipient.id;
    const userMessage = message.message?.text || '';
    const isEcho = message.message?.is_echo || false;
    const messageType = isEcho ? 'sent' : 'received';

    const businessInstagramId = isEcho ? senderId : recipientId;
    const customerId = isEcho ? recipientId : senderId;

    const businessId = await resolveBusinessIdByInstagramId(businessInstagramId);
    if (!businessId) {
      console.error('[WARN] Could not resolve business_id for Instagram ID:', businessInstagramId);
      return;
    }

    // Check if the partition for this business_id exists
    const partitionName = `instagram_conversations_p${businessId}`;
    const partitionExists = await doesPartitionExist(partitionName);

    if (!partitionExists) {
      console.error(`[ERROR] Partition does not exist for business_id ${businessId}. Please create it manually.`);
      return;
    }

    const messageContent = userMessage;
    const { error: conversationError } = await supabase
      .from('instagram_conversations')
      .insert([
        {
          business_id: businessId,
          sender_id: customerId,
          recipient_id: businessInstagramId,
          message: messageContent,
          message_type: messageType,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

    if (conversationError) throw new Error(`Failed to insert conversation: ${conversationError.message}`);
    console.log('[DEBUG] Conversation inserted successfully.');
  } catch (error) {
    console.error('[ERROR] Failed to process messaging event:', error.message);
  }
}

// Webhook Verification (GET)
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Fetch Conversations (GET)
router.get('/fetch-conversations', async (req, res) => {
  try {
    const { business_id } = req.query;

    if (!business_id) {
      return res.status(400).json({ error: 'business_id is required.' });
    }

    const { data: conversations, error } = await supabase
      .from('instagram_conversations')
      .select('id, sender_id, recipient_id, message, message_type, created_at')
      .eq('business_id', business_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[ERROR] Failed to fetch conversations:', error.message);
      return res.status(500).json({ error: 'Failed to fetch conversations.' });
    }

    res.status(200).json({ conversations });
  } catch (err) {
    console.error('[ERROR] Unexpected error in /fetch-conversations:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Webhook Event Handler (POST)
router.post(
  '/',
  webhookLimiter,
  express.json({ verify: verifyFacebookSignature }),
  async (req, res) => {
    try {
      const body = req.body;
      if (body.object !== 'instagram') {
        throw new Error('Invalid webhook payload.');
      }
      for (const entry of body.entry) {
        if (Array.isArray(entry.messaging)) {
          for (const message of entry.messaging) {
            const { error } = messageSchema.validate(message);
            if (!error) {
              await processMessagingEvent(message);
            } else {
              console.error('[ERROR] Invalid message format:', error.details);
            }
          }
        }
      }
      res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      console.error('[ERROR] Failed to process webhook:', error.message);
      res.status(500).send('Internal Server Error');
    }
  }
);

export default router;
