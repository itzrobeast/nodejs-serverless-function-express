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
async function fetchBusinessInstagramId(businessId) {
  try {
    const details = await fetchBusinessDetails(businessId);
    if (!details) return null;
    console.log(`[INFO] ig_id for businessId=${businessId}: ${details.ig_id}`);
    return details.ig_id;
  } catch (err) {
    console.error('[ERROR] Exception while fetching ig_id:', err.message);
    return null;
  }
}

/**
 * Retrieve the page access token for the specified business and page.
 */
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
    const { data: business, error } = await supabase
      .from('businesses')
      .select('id, ig_id')
      .eq('ig_id', instagramId)
      .single();

    if (error || !business) {
      console.warn('[WARN] Business not found for Instagram ID:', instagramId);
      return null;
    }

    const businessInstagramId = business.ig_id;

    console.log(`[DEBUG] Resolved business ID: ${business.id} for Instagram ID: ${business.ig_id}`);
    return business.id;
  } catch (err) {
    console.error('[ERROR] Error resolving business ID:', err.message);
    return null;
  }
}

/**
 * Ensure the necessary partition(s) exists for the given businessId.
 * If not, create it.
 */
async function ensurePartitionExists(businessId) {
  try {
    // Ensure the business actually exists
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .single();

    if (businessError || !business) {
      console.log(`[INFO] No business found for business_id: ${businessId}, skipping partition creation.`);
      return;
    }

    // Partition naming for 'instagram_users' table
    const partitionName = `instagram_users_${businessId}`;

    // 1) Check if partition exists
    const { data: partitionCheck, error: partitionCheckError } = await supabase.rpc('check_partition_exists', {
      partition_name: partitionName,
    });

    if (partitionCheckError) {
      console.error(`[ERROR] Failed to check partition existence: ${partitionCheckError.message}`);
      throw new Error(partitionCheckError.message);
    }

    // 2) If not exists, create it
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

    // If you also need a partition for "instagram_conversations", replicate similar logic
  } catch (err) {
    console.error('[ERROR] Failed to ensure partition exists:', err.message);
  }
}

/**
 * Fetch Instagram user info (username, etc.) from the Graph API.
 */
async function fetchInstagramUserInfo(senderId, businessId, pageId, pageAccessToken) {
  try {
    console.log('[DEBUG] Fetching Instagram User Info for:', senderId);

    const url = `https://graph.facebook.com/v15.0/${senderId}?fields=id,username&access_token=${pageAccessToken}`;
    console.log('[DEBUG] Request URL:', url);

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      console.error('[ERROR] Instagram API Error:', data);
      if (data.error?.code === 803) {
        console.warn('[WARN] IGSID not found for senderId:', senderId);
      }
      return null;
    }

    console.log('[DEBUG] Instagram User Info:', data);
    return data;
  } catch (err) {
    console.error('[ERROR] Fetching Instagram User Info:', err.message);
    return null;
  }
}

/**
 * Update known user fields in 'instagram_users' (name, phone, email, location).
 */
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

/**
 * Simple text parsing to see if user includes name, phone, email, or location.
 */
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

/**
 * Upsert the user into 'instagram_users' table.
 */
async function upsertInstagramUser(senderId, businessId) {
  try {
    // 1) Fetch the business's Instagram ID
    const businessIgId = await fetchBusinessInstagramId(businessId);
    if (!businessIgId) {
      console.error(`[ERROR] Could not fetch ig_id for businessId=${businessId}. Cannot determine user role.`);
      return;
    }

    // 2) Determine user role: 'business' or 'customer'
    const role = senderId === businessIgId ? 'business' : 'customer';

    // 3) Fetch user info from Instagram Graph API
    // Note: userInfo is already fetched in processMessagingEvent
    // Here, we assume username is passed or fetched elsewhere

    // 4) Prepare data for upsert
    const userData = {
      id: senderId,
      business_id: businessId,
      username: null, // Placeholder if not available
      role,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // 5) Upsert
    const { error } = await supabase
      .from('instagram_users')
      .upsert(userData, { onConflict: ['id', 'business_id'] });

    if (error) {
      console.error('[ERROR] Failed to upsert Instagram user:', error.message);
      throw new Error(error.message);
    }

    console.log(`[INFO] Instagram user ${senderId} added or updated successfully.`);
  } catch (err) {
    console.error('[ERROR] Failed to upsert Instagram user:', err.message);
  }
}

/**
 * Send a plain-text message to an Instagram user.
 */
async function sendInstagramMessage(recipientId, message, businessId, pageId, pageAccessToken) {
  try {
    if (!message || typeof message !== 'string') {
      throw new Error('Invalid message content.');
    }
    console.log(`[DEBUG] Sending message to Instagram user ${recipientId}: "${message}"`);

    const response = await fetch(
      `https://graph.facebook.com/v14.0/me/messages?access_token=${pageAccessToken}`,
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
  } catch (err) {
    console.error('[ERROR] Failed to send Instagram message:', err.message);
    throw err;
  }
}

/**
 * Handle an "unsent" (deleted) message, removing it from 'instagram_conversations'.
 */
async function handleUnsentMessage(mid, businessId) {
  try {
    console.log(`[DEBUG] Attempting to delete message with ID: ${mid} for business ID: ${businessId}`);
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

    // Ensure necessary database partitions exist
    console.log(`[DEBUG] Ensuring partitions for business ID: ${businessId}`);
    await ensurePartitionExists(businessId);
    console.log('[DEBUG] Partitions verified or created.');

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
    const isBusinessMessage = senderId === businessIgId; // Defined here
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

    // Parse user message for specific fields
    const { field, value } = parseUserMessage(userMessage);
    if (field && value) {
      await updateInstagramUserInfo(senderId, businessId, field, value);
    }

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
 * Route to fetch all conversations for a given business.
 */
router.get('/fetch-conversations', async (req, res) => {
  try {
    const { business_id } = req.query;
    if (!business_id) {
      return res.status(400).json({ error: 'business_id is required.' });
    }

    // Fetch the existing conversation entries
    const { data: conversations, error: conversationsError } = await supabase
      .from('instagram_conversations')
      .select('id, sender_id, recipient_id, message, message_type, created_at, sender_name, role')
      .eq('business_id', business_id);

    if (conversationsError) {
      console.error('[ERROR] Failed to fetch conversations:', conversationsError.message);
      return res.status(500).json({ error: 'Failed to fetch conversations.' });
    }

    // Fetch the business's ig_id
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('ig_id')
      .eq('id', business_id)
      .single();

    if (businessError || !business) {
      console.error('[ERROR] Failed to fetch business Instagram ID:', businessError?.message || 'No data found');
      return res.status(500).json({ error: 'Failed to fetch business data.' });
    }

    const businessIgId = business.ig_id;
    console.log(`[DEBUG] Fetched business Instagram ID: ${businessIgId}`);

    // "Enrich" each conversation row with the correct role if missing
    const enrichedConversations = conversations.map((msg) => ({
      ...msg,
      role: msg.role || (msg.sender_id === businessIgId ? 'business' : 'customer'),
    }));

    console.log(`[INFO] Successfully enriched ${enrichedConversations.length} conversations.`);
    return res.status(200).json(enrichedConversations);
  } catch (err) {
    console.error('[ERROR] Unexpected error in /fetch-conversations:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

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

    // Handle permissions changes
    if (object === 'permissions') {
      console.log('[INFO] Handling permissions change:', entry);
      return res.status(200).send('Permissions handled');
    }

    // Handle Instagram messaging
    if (object === 'instagram') {
      console.log('[INFO] Handling Instagram messaging event:', entry);
      for (const event of entry) {
        if (event.messaging) {
          for (const messageEvent of event.messaging) {
            // Validate message structure
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

    // Fallback for unhandled object types
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
