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




/**
 * Helper to fetch business ID from Instagram ID.
 * @param {string} igId - The recipient’s (business) Instagram ID.
 * @returns {Promise<number|null>} Business ID or null if not found.
 */
async function fetchBusinessIdFromInstagramId(igId) {
  // Validate igId: it must be a valid large integer as a string
  if (!igId || typeof igId !== 'string' || !/^\d+$/.test(igId)) {
    console.error('[ERROR] Invalid or missing ig_id:', igId);
    return null;
  }

  console.log(`[DEBUG] Received igId: ${igId}, Type: ${typeof igId}`);

  // Convert to BigInt for safe handling of large numbers
  const numericIgId = BigInt(igId);
  console.log(`[DEBUG] Querying business ID for ig_id=${numericIgId}`);

  try {
    // Query the database using igId as-is
    const { data, error } = await supabase
      .from('businesses')
      .select('id')
      .eq('ig_id', numericIgId.toString()) // Convert BigInt back to string for query
      .limit(1)
      .single();

    if (error) {
      console.error(`[ERROR] Supabase error for ig_id=${numericIgId}:`, error.message);
      return null;
    }

    if (!data) {
      console.error(`[ERROR] No data found for ig_id=${numericIgId}`);
      return null;
    }

    console.log(`[DEBUG] Successfully retrieved business ID: ${data.id}`);
    return data.id;
  } catch (err) {
    console.error(`[ERROR] Exception during database query for ig_id=${numericIgId}:`, err.message, err.stack);
    return null;
  }
}



/**
 * Send a response message to the user and log it as "sent" by the business.
 * @param {number} businessId
 * @param {string} senderId   - The user's IG ID (who sent the message).
 * @param {string} recipientId - The business's IG ID.
 * @param {string} messageText - The text to send to the user.
 * @param {string} igId       - The same as recipientId (business’s IG ID).
 * @param {string} username   - The user’s username (if known).
 * @param {object} businessDetails - Contains page_id, etc.
 */
async function respondAndLog(
  businessId,
  senderId,
  recipientId,
  messageText,
  igId,
  username,
  businessDetails,
  messageId
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

    // Generate a unique message ID
    const generatedMessageId = crypto.randomUUID();  // ✅ Always generate a message ID

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
      senderId: recipientId, // Business is the sender
      recipientId: senderId,
      message: messageText,
      type: 'sent',
      role: 'business',
      igId,
      username: 'Business',
      messageId: generatedMessageId,  // ✅ Use the generated ID
    });

  } catch (err) {
    console.error(`[ERROR] Failed to respond and log message for businessId=${businessId}:`, err.message);
  }
}



const lastUserMessages  = new Map(); // In-memory rate-limiting store
const processedEvents = new Set();
/**
 * Core function to process incoming messages.
 * - Logs the incoming "received" message.
 * - Retrieves user info.
 * - Calls the assistant handler for a reply.
 * - Uses respondAndLog() to send the reply and log the "sent" message.
 */
async function processMessagingEvent(messageEvent) {
  try {
    console.log('[DEBUG] Incoming message payload:', JSON.stringify(messageEvent, null, 2));

    const senderId = messageEvent.sender?.id;
    const recipientId = messageEvent.recipient?.id;

    if (!senderId || !recipientId) {
      console.error('[ERROR] senderId or recipientId is missing in message payload.');
      return;
    }

    const uniqueEventKey = `${messageEvent.message?.mid}-${senderId}-${recipientId}-${messageEvent.timestamp}`;
    if (processedEvents.has(uniqueEventKey)) {
      console.log('[INFO] Duplicate event detected. Skipping processing.');
      return;
    }
    processedEvents.add(uniqueEventKey);
    setTimeout(() => processedEvents.delete(uniqueEventKey), 60 * 1000);

    const isDeleted = messageEvent.message?.is_deleted || false;
    const isEcho = messageEvent.message?.is_echo || false;
    const userMessage = messageEvent.message?.text || '';
    const messageId = messageEvent.message?.mid?.trim();

    let businessId = null;
    if (isDeleted || !isEcho) {
      businessId = await fetchBusinessIdFromInstagramId(recipientId);
      if (!businessId) {
        console.error('[ERROR] Business ID not found for recipient IG ID:', recipientId);
      }
    }

    if (isDeleted) {
      if (!businessId) return;
      console.log('[DEBUG] Deleting unsent message with:', { messageId, businessId });
      await handleUnsentMessage(messageId, businessId);
      return;
    }

    if (isEcho || !userMessage.trim()) {
      console.log('[INFO] Ignoring echo or empty message.');
      return;
    }

    

    if (!businessId) {
      console.log('[INFO] Message is from a customer; no known business ID. Logging normally.');
      await logMessage({ businessId: null, senderId, recipientId, message: userMessage, type: 'received', role: 'customer', igId: recipientId, messageId });
      return;
    }

    const businessDetails = await fetchBusinessDetails(businessId);
    if (!businessDetails) {
      console.error(`[ERROR] Could not fetch business details for businessId=${businessId}`);
      return;
    }

    const pageAccessToken = await getPageAccessToken(businessId, businessDetails.page_id) || await forceRefreshPageAccessToken(businessId, businessDetails.page_id);
    if (!pageAccessToken) return;

    const userInfo = await fetchInstagramUserInfo(senderId, businessId);
    if (userInfo) {
      console.log('[DEBUG] Fetched user info:', JSON.stringify(userInfo));
      await upsertInstagramUser(senderId, userInfo, businessId, 'customer', null, recipientId);
    }

    await logMessage({ businessId, senderId, recipientId, message: userMessage, type: 'received', role: 'customer', igId: recipientId, username: userInfo?.username || '', messageId });

    const assistantResponse = await assistantHandler({ userMessage, businessId });
    if (assistantResponse?.message) {
      
      await respondAndLog(businessId, senderId, recipientId, assistantResponse.message, recipientId, userInfo?.username || '', businessDetails, generatedMessageId );
    }
  } catch (err) {
    console.error('[ERROR] Failed to process messaging event:', err.message);
  }
}




// POST route for webhook
router.post('/', async (req, res) => {
  try {
    const { object, entry } = req.body;

    if (object === 'instagram') {
      for (const event of entry) {
        console.log(`[DEBUG] Entry ID: ${event.id}, Timestamp: ${event.time}`);
        console.log('[DEBUG] Full Event Payload:', JSON.stringify(event, null, 2));

        // 1️⃣ Handle direct messaging events
        if (event.messaging) {
          for (const messageEvent of event.messaging) {
            const isDeleted = messageEvent.message?.is_deleted;
            const isEcho = messageEvent.message?.is_echo;

            if (isDeleted) {
              console.log('[INFO] Deleted message detected:', messageEvent.message.mid);
              const businessId = await fetchBusinessIdFromInstagramId(messageEvent.recipient?.id);
              await handleUnsentMessage(messageEvent.message.mid, businessId);
              continue;
            }

            if (!isEcho) {
              await processMessagingEvent(messageEvent);
            }
          }
        }

        // 2️⃣ Handle data changes (including message deletions)
        if (event.changes) {
          for (const change of event.changes) {
            if (change.field === 'messages' && change.value?.is_deleted) {
              console.log('[INFO] Message deleted via change event:', change.value.mid);
              const businessId = await fetchBusinessIdFromInstagramId(change.value.recipient_id);
              await handleUnsentMessage(change.value.mid, businessId);
            }
          }
        }

        // 3️⃣ Handle standby events (when the app is not the primary receiver)
        if (event.standby) {
          console.log('[INFO] Standby event detected:', event.standby);
        }
      }

      return res.status(200).send('Instagram messaging handled');
    }

    console.log('[WARN] Unhandled object type:', object);
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

// Optional route to fetch all conversation logs for a given business
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
