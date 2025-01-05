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
  businessDetails
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
      senderId: recipientId, // The "business" is effectively the sender now
      recipientId: senderId,
      message: messageText,
      type: 'sent',
      role: 'business',
      igId,
      username: 'Business',
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

    // Extract sender and recipient IDs
    const senderId = messageEvent.sender?.id;
    const recipientId = messageEvent.recipient?.id;

    if (!senderId || !recipientId) {
      console.error('[ERROR] senderId or recipientId is missing in message payload.');
      return;
    }

    const uniqueEventKey = `${messageEvent.message?.mid}-${messageEvent.sender?.id}-${messageEvent.recipient?.id}-${messageEvent.timestamp}`;
    if (processedEvents.has(uniqueEventKey)) {
        console.log('[INFO] Duplicate event detected. Skipping processing.');
        return;
    }
    processedEvents.add(uniqueEventKey);
    setTimeout(() => processedEvents.delete(uniqueEventKey), 60 * 1000); // Keep track for 1 minute

    // Build a conversation key
    const conversationKey = `${senderId}-${recipientId}`;

    // Determine whether the message is deleted or an echo
    const isDeleted = messageEvent.message?.is_deleted || false;
    const isEcho = messageEvent.message?.is_echo || false;
    const userMessage = messageEvent.message?.text || '';
    const messageId = messageEvent.message?.mid?.trim();

    // Debug logs
    console.log(`[DEBUG] Sender IG ID: ${senderId}, Recipient IG ID: ${recipientId}`);

    // 1) Handle deleted messages
    if (isDeleted) {
      if (!messageId) {
        console.warn('[WARN] Deleted message does not have a valid message ID.');
        return;
      }
      console.log(`[INFO] Handling deleted message with ID: ${messageId}`);
      await handleUnsentMessage(messageId);
      return;
    }

    // 2) Ignore echo or empty messages
    if (isEcho || !userMessage.trim()) {
      console.log('[INFO] Ignoring echo or empty message.');
      return;
    }

    /*****************************************************************
     * 3) Skip if user repeats the exact same message as last time
     *****************************************************************/
    const lastMessage = lastUserMessages.get(conversationKey);
    if (lastMessage && lastMessage === userMessage) {
      console.log(`[INFO] Skipping assistant response. User repeated text: "${userMessage}"`);
      // Optionally still log it if you want, or just skip everything
      // For example:
      await logMessage({
        businessId: null, // If no business or skip your logic
        senderId,
        recipientId,
        message: userMessage,
        type: 'received',
        role: 'customer',
      });
      return; // do NOT call the assistant
    }

    // Store this as the last user text for 5 minutes
    lastUserMessages.set(conversationKey, userMessage);
    setTimeout(() => {
      // After 5 minutes, forget the last user text for this conversation
      lastUserMessages.delete(conversationKey);
    }, 1 * 60 * 1000);

    // 4) Identify if the recipient is your business
    const businessId = await fetchBusinessIdFromInstagramId(recipientId);
    if (!businessId) {
      console.log('[INFO] Message is from a customer; no known business ID. Logging normally.');
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

    console.log(`[DEBUG] Business ID resolved for recipient IG ID: ${recipientId}`);

    // 5) Fetch business details
    const businessDetails = await fetchBusinessDetails(businessId);
    if (!businessDetails) {
      console.error(`[ERROR] Could not fetch business details for businessId=${businessId}`);
      return;
    }
    console.log('[DEBUG] Business details fetched:', JSON.stringify(businessDetails));

    // 6) Possibly fetch & validate page access token, user info, etc.
    //    Example: 
    let pageAccessToken = await getPageAccessToken(businessId, businessDetails.page_id);
    if (!pageAccessToken) {
      pageAccessToken = await forceRefreshPageAccessToken(businessId, businessDetails.page_id);
      if (!pageAccessToken) return;
    }

    const userInfo = await fetchInstagramUserInfo(senderId, businessId);
    if (userInfo) {
      console.log('[DEBUG] Fetched user info:', JSON.stringify(userInfo));
      await upsertInstagramUser(senderId, userInfo, businessId, 'customer', null, recipientId);
    }

    // 7) Log the received message in DB
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

    // 8) Generate assistant response
    const assistantResponse = await assistantHandler({ userMessage, businessId });
    if (assistantResponse?.message) {
      // 9) Log + respond
      await logMessage({
        businessId,
        senderId: recipientId,
        recipientId: senderId,
        message: assistantResponse.message,
        type: 'sent',
        role: 'business',
        igId: recipientId,
        username: 'Business',
      });

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

        if (event.messaging) {
          for (const messageEvent of event.messaging) {
            // Skip echo messages
            if (messageEvent.message?.is_echo) {
              console.log('[INFO] Skipping echo message:', messageEvent.message.mid);
              continue;
            }

            // Skip read receipts
            if (messageEvent.read) {
              console.log('[INFO] Skipping read receipt for:', messageEvent.read.mid);
              continue;
            }

            const uniqueEventKey = `${messageEvent.message?.mid}-${messageEvent.sender?.id}-${messageEvent.recipient?.id}-${messageEvent.timestamp}`;
            console.log(`[DEBUG] Unique Event Key: ${uniqueEventKey}`);

            // Process the messaging event
            await processMessagingEvent(messageEvent);
          }
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
