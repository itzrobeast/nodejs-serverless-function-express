import express from 'express';
import fetch from 'node-fetch';
import supabase from './supabaseClient.js';

const router = express.Router();

const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

/**
 * Resolve `business_id` using recipient (Instagram Business Account ID).
 */
async function resolveBusinessIdByInstagramId(recipientId) {
  try {
    const { data: business, error } = await supabase
      .from('businesses')
      .select('id')
      .eq('ig_id', recipientId)
      .single();

    if (error || !business) {
      console.error(`[ERROR] No business found for ig_id: ${recipientId}`);
      return null;
    }

    console.log(`[DEBUG] Resolved business_id: ${business.id} for recipient: ${recipientId}`);
    return business.id;
  } catch (err) {
    console.error('[ERROR] Error resolving business_id:', err.message);
    return null;
  }
}

/**
 * Insert conversation into `instagram_conversations` table.
 */
async function upsertConversation(businessId, senderId, recipientId, userMessage) {
  try {
    const { error } = await supabase
      .from('instagram_conversations')
      .insert([
        {
          business_id: businessId,
          sender_id: senderId,
          recipient_id: recipientId,
          message: userMessage,
          message_type: 'received',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

    if (error) {
      console.error('[ERROR] Failed to insert Instagram conversation:', error.message);
      throw new Error('Failed to insert Instagram conversation');
    }

    console.log('[DEBUG] Instagram conversation upserted successfully.');
  } catch (err) {
    console.error('[ERROR] Failed to upsert conversation:', err.message);
    throw err;
  }
}

/**
 * Process individual messaging events from the Instagram webhook callback.
 */
async function processMessagingEvent(message) {
  try {
    console.log('[DEBUG] Full message object:', JSON.stringify(message, null, 2));

    const userMessage = message?.message?.text; // Message text
    const senderId = message?.sender?.id; // Instagram User ID (customer)
    const recipientId = message?.recipient?.id; // Instagram Business Account ID

    if (!userMessage || !recipientId || !senderId) {
      console.error('[ERROR] Missing message, recipientId, or senderId.');
      return;
    }

    console.log('[DEBUG] Extracted message details:', {
      userMessage,
      recipientId,
      senderId,
    });

    // Resolve `business_id` using recipientId
    const businessId = await resolveBusinessIdByInstagramId(recipientId);
    if (!businessId) {
      console.error(`[ERROR] No business found for recipient: ${recipientId}`);
      return;
    }

    // Upsert conversation
    await upsertConversation(businessId, senderId, recipientId, userMessage);
  } catch (err) {
    console.error('[ERROR] Failed to process messaging event:', err.message);
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
 * Webhook event handler (POST)
 */
router.post('/', async (req, res) => {
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
});

export default router;
