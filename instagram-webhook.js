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
    read: Joi.object().optional(), // Allow "read" as an optional field
    attachments: Joi.array().items(
      Joi.object({
        type: Joi.string().required(),
        payload: Joi.object().required(),
      })
    ),
  }).unknown(true), // Allow unknown keys for future-proofing
});


// Helper Function to Resolve Business ID from Instagram ID
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

// Helper Function to Ensure Partition Exists
async function ensurePartitionExists(businessId) {
  try {
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .single();

    if (businessError || !business) {
      console.log(`[INFO] No business found for business_id: ${businessId}, skipping partition creation.`);
      return;
    }

    const partitionName = `instagram_users_${businessId}`;
    const { data: partitionCheck, error: partitionCheckError } = await supabase.rpc('check_partition_exists', {
      partition_name: partitionName,
    });

    if (partitionCheckError) {
      console.error(`[ERROR] Failed to check partition existence: ${partitionCheckError.message}`);
      throw new Error(partitionCheckError.message);
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
  } catch (err) {
    console.error('[ERROR] Failed to ensure partition exists:', err.message);
  }
}

// Helper Function to Fetch User Info from Instagram
async function fetchInstagramUserInfo(senderId) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v15.0/${senderId}?fields=id,username&access_token=${PAGE_ACCESS_TOKEN}`
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch user info: ${errorText}`);
    }

    const userInfo = await response.json();
    console.log(`[INFO] Fetched user info for senderId ${senderId}:`, userInfo);
    return userInfo;
  } catch (error) {
    console.error('[ERROR] Failed to fetch Instagram user info:', error.message);
    return null;
  }
}

async function updateInstagramUserInfo(senderId, businessId, field, value) {
  try {
    const validFields = ['name', 'phone', 'email', 'location'];
    if (!validFields.includes(field)) {
      throw new Error('Invalid field for update');
    }

    const { error } = await supabase
      .from('instagram_users')
      .update({ [field]: value, updated_at: new Date() })
      .eq('id', senderId)
      .eq('business_id', businessId);

    if (error) {
      console.error(`[ERROR] Failed to update user info for senderId ${senderId}:`, error.message);
    } else {
      console.log(`[INFO] Successfully updated ${field} for user ${senderId}.`);
    }
  } catch (err) {
    console.error('[ERROR] Failed to update Instagram user info:', err.message);
  }
}





// Helper Function to Parse User Messages
function parseUserMessage(message) {
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
}


// Add or Update the User in the instagram_users Table
async function upsertInstagramUser(senderId, businessId) {
  try {
    // Check if the senderId is the business's Instagram ID
    const role = senderId === BUSINESS_IG_ID ? 'business' : 'customer';

    // Fetch user info from Instagram Graph API
    const userInfo = await fetchInstagramUserInfo(senderId);

    const userData = {
      id: senderId,
      business_id: businessId,
      username: userInfo?.username || null,
      role,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const { data, error } = await supabase
      .from('instagram_users')
      .upsert(userData, { onConflict: ['id', 'business_id'] }); // Ensure no duplicate users for the same business

    if (error) {
      console.error('[ERROR] Failed to upsert Instagram user:', error.message);
      throw new Error(error.message);
    }

    console.log(`[INFO] Instagram user ${senderId} added or updated successfully.`);
  } catch (err) {
    console.error('[ERROR] Failed to upsert Instagram user:', err.message);
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




// Helper Function to Handle Unsent Messages
async function handleUnsentMessage(mid, businessId) {
  try {
    const { error } = await supabase
      .from('instagram_conversations')
      .delete()
      .match({ business_id: businessId, message_id: mid });

    if (error) {
      console.error('[ERROR] Failed to delete unsent message:', error.message);
      throw new Error(error.message);
    }
    console.log(`[INFO] Successfully removed unsent message with ID: ${mid}`);
  } catch (err) {
    console.error('[ERROR] Failed to handle unsent message:', err.message);
  }
}

// Helper Function to Log Message
async function logMessage(businessId, senderId, recipientId, message, type, mid) {
  try {
    const { error } = await supabase
      .from('instagram_conversations')
      .insert([{
        business_id: businessId,
        sender_id: senderId,
        recipient_id: recipientId,
        message,
        message_type: type,
        message_id: mid, // Unique message ID from Instagram
        created_at: new Date(),
        updated_at: new Date(),
      }]);

    if (error) {
      console.error('[ERROR] Failed to log message:', error.message);
      throw new Error(error.message);
    }
    console.log(`[INFO] Message logged successfully for business ${businessId}`);
  } catch (err) {
    console.error('[ERROR] Failed to log message:', err.message);
  }
}

const senderId = message.sender?.id;
if (!senderId) {
  console.error('[ERROR] senderId is undefined in the message payload:', message);
  return; // Prevent further execution
}




// Process Individual Messaging Event
async function processMessagingEvent(message) {
  try {
    const senderId = message.sender.id;
    const recipientId = message.recipient.id;
    const isEcho = message.message?.is_echo || false;
    const isUnsent = message.message?.is_unsent || false;
    const userMessage = message.message?.text || '';
    const messageId = message.message?.mid;

    if (isEcho) {
      console.log('[INFO] Ignoring echo message.');
      return;
    }

    const businessInstagramId = recipientId;
    const businessId = await resolveBusinessIdByInstagramId(businessInstagramId);

    if (!businessId) {
      console.error('[WARN] Could not resolve business_id for Instagram ID:', businessInstagramId);
      return;
    }

    // Ensure the user exists in the instagram_users table, pulling info from Instagram if necessary
    await upsertInstagramUser(senderId, businessId);
    await ensurePartitionExists(businessId);

    // Handle unsent message
    if (isUnsent) {
      await handleUnsentMessage(messageId, businessId);
      return;
    }

    // Log the received message
    await logMessage(businessId, senderId, businessInstagramId, userMessage, 'received', messageId);

    // Parse and update user info
    const { field, value } = parseUserMessage(userMessage);
    if (field && value) {
      await updateInstagramUserInfo(senderId, businessId, field, value);
    }

    // Generate assistant response
    const assistantResponse = await assistantHandler({ userMessage, businessId });
    if (assistantResponse && assistantResponse.message) {
      await sendInstagramMessage(senderId, assistantResponse.message);
      await logMessage(businessId, businessInstagramId, senderId, assistantResponse.message, 'sent', null);
    }
  } catch (err) {
    console.error('[ERROR] Failed to process messaging event:', err.message);
  }
}







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
