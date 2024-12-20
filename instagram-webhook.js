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

if (!VERIFY_TOKEN || !PAGE_ACCESS_TOKEN || !FACEBOOK_APP_SECRET) {
  console.error('[ERROR] Missing required environment variables.');
  process.exit(1);
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

// Helper Function to Ensure Partition Exists
async function ensurePartitionExists(businessId) {
  const partitionName = `instagram_conversations_${businessId}`;

  const { data: partitionCheck, error: checkError } = await supabase.rpc('check_partition_exists', {
    partition_name: partitionName,
  });

  if (checkError) {
    console.error(`[ERROR] Failed to check partition existence: ${checkError.message}`);
    throw new Error(checkError.message);
  }

  if (!partitionCheck || !partitionCheck[0]?.exists) {
    console.log(`[INFO] Partition ${partitionName} does not exist. Creating it.`);
    const { error: creationError } = await supabase.rpc('create_partition', { business_id: businessId });
    if (creationError) {
      console.error(`[ERROR] Failed to create partition for business_id ${businessId}:`, creationError.message);
      throw new Error(creationError.message);
    }
    console.log(`[INFO] Partition ${partitionName} created successfully.`);
  } else {
    console.log(`[INFO] Partition ${partitionName} already exists.`);
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

// Helper Function to Update Instagram User Info
async function updateInstagramUserInfo(senderId, businessId, field, value) {
  try {
    const validFields = ['name', 'phone', 'location', 'email'];
    if (!validFields.includes(field)) {
      throw new Error('Invalid field name');
    }

    const { error } = await supabase
      .from(`instagram_users_${businessId}`)
      .upsert([
        {
          id: senderId,
          business_id: businessId,
          [field]: value,
          updated_at: new Date(),
        },
      ]);

    if (error) {
      console.error(`[ERROR] Failed to update ${field}:`, error.message);
      throw new Error(`Failed to update ${field}`);
    }

    console.log(`[INFO] Successfully updated ${field} for user ${senderId}`);
  } catch (err) {
    console.error('[ERROR] Failed to update user info:', err.message);
  }
}

// Parse User Messages to Extract Info
const parseUserMessage = (message) => {
  const namePattern = /my name is (\w+ \w+)/i;
  const phonePattern = /(?:phone|contact) (?:number|is) (\+?\d{1,2}\s?)?\(?(\d{3})\)?\s?(\d{3})[\s.-]?(\d{4})/i;
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/i;
  const locationPattern = /I am from (\w+),? (\w+)/i;

  let field = '';
  let value = '';

  if (namePattern.test(message)) {
    field = 'name';
    value = message.match(namePattern)[1];
  } else if (phonePattern.test(message)) {
    field = 'phone';
    value = message.match(phonePattern).slice(1).join('');
  } else if (emailPattern.test(message)) {
    field = 'email';
    value = message.match(emailPattern)[0];
  } else if (locationPattern.test(message)) {
    field = 'location';
    value = message.match(locationPattern).slice(1).join(', ');
  }

  return { field, value };
};

// Process Individual Messaging Events
async function processMessagingEvent(message) {
  try {
    console.log('[DEBUG] Processing message:', JSON.stringify(message, null, 2));

    const senderId = message.sender.id;
    const recipientId = message.recipient.id;
    const userMessage = message.message?.text || '';
    const isEcho = message.message?.is_echo || false;

    if (isEcho) {
      console.log('[INFO] Ignoring echo message.');
      return;
    }

    const businessInstagramId = recipientId;
    const customerId = senderId;

    const businessId = await resolveBusinessIdByInstagramId(businessInstagramId);
    if (!businessId) {
      console.error('[WARN] Could not resolve business_id for Instagram ID:', businessInstagramId);
      return;
    }

    await ensurePartitionExists(businessId);

    const { error: conversationError } = await supabase
      .from('instagram_conversations')
      .insert([
        {
          business_id: businessId,
          sender_id: customerId,
          recipient_id: businessInstagramId,
          message: userMessage,
          message_type: 'received',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

    if (conversationError) {
      console.error('[ERROR] Failed to insert conversation:', conversationError.message);
      throw new Error(`Failed to insert conversation: ${conversationError.message}`);
    }
    console.log('[DEBUG] Conversation inserted successfully.');

    const { field, value } = parseUserMessage(userMessage);
    if (field && value) {
      await updateInstagramUserInfo(senderId, businessId, field, value);
    }

    console.log('[INFO] Sending message to assistant for processing...');
    const assistantResponse = await assistantHandler({
      userMessage,
      businessId,
    });

    if (assistantResponse && assistantResponse.message) {
      await sendInstagramMessage(customerId, assistantResponse.message);

      console.log(`[DEBUG] Assistant response sent to user: "${assistantResponse.message}"`);

      const { error: botMessageError } = await supabase
        .from('instagram_conversations')
        .insert([
          {
            business_id: businessId,
            sender_id: businessInstagramId,
            recipient_id: customerId,
            message: assistantResponse.message,
            message_type: 'sent',
            created_at: new Date(),
            updated_at: new Date(),
          },
        ]);

      if (botMessageError) {
        console.error('[ERROR] Failed to log bot response:', botMessageError.message);
      }
    } else {
      console.warn('[WARN] Assistant did not generate a response.');
    }
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
