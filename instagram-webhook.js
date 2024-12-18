import express from 'express';
import fetch from 'node-fetch';
import supabase from './supabaseClient.js';
import assistantHandler from './assistant.js';

const router = express.Router();

const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

/**
 * Fetch Instagram User Name
 * @param {String} senderId - Instagram User ID
 */
async function fetchInstagramUserName(senderId) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v14.0/${senderId}?fields=name&access_token=${PAGE_ACCESS_TOKEN}`
    );
    if (!response.ok) {
      console.warn('[WARN] Failed to fetch user name:', await response.text());
      return null;
    }
    const data = await response.json();
    return data.name || null;
  } catch (error) {
    console.error('[ERROR] Failed to fetch Instagram user name:', error.message);
    return null;
  }
}

/**
 * Send a direct reply to an Instagram user using your Page Access Token.
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
      console.error('[ERROR] Failed to send Instagram message:', errorText);
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
 * Process individual messaging events from the Instagram webhook callback.
 */
const processMessagingEvent = async (message) => {
  try {
    console.log('[DEBUG] Full message object:', JSON.stringify(message, null, 2));

    const userMessage = message?.message?.text;
    const senderId = message?.sender?.id; // Instagram User ID (customer)
    const recipientId = message?.recipient?.id; // Instagram Business Account ID
    const messageType = 'received';

    if (!userMessage || !recipientId || !senderId) {
      console.error('[ERROR] Missing message, recipientId, or senderId.');
      return;
    }

    console.log('[DEBUG] Extracted message details:', {
      userMessage,
      recipientId,
      senderId,
      messageType,
    });

    // Fetch sender's name
    const senderName = await fetchInstagramUserName(senderId);

    // Resolve `business_id` using recipientId
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id')
      .eq('ig_id', recipientId)
      .single();

    if (businessError || !business) {
      console.error('[ERROR] Business not found for recipient:', recipientId);
      return;
    }

    const businessId = business.id;
    console.log('[DEBUG] Resolved business_id:', businessId);

    // Upsert conversation into the `instagram_conversations` table
    const { error: conversationError } = await supabase
      .from('instagram_conversations')
      .insert([
        {
          business_id: businessId,
          sender_id: senderId,
          sender_name: senderName, // Include sender's name
          recipient_id: recipientId,
          message: userMessage,
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

    // Generate AI response using assistant.js
    console.log('[DEBUG] Generating AI response.');
    const assistantResponse = await assistantHandler({
      userMessage,
      recipientId,
      platform: 'instagram',
      businessId,
    });

    // Send AI response back to sender
    if (assistantResponse && assistantResponse.message) {
      console.log('[DEBUG] Assistant response:', assistantResponse.message);
      await sendInstagramMessage(senderId, assistantResponse.message);
    } else {
      console.warn('[WARN] Assistant response is missing or invalid.');
    }
  } catch (error) {
    console.error('[ERROR] Failed to process messaging event:', error.message);
  }
};

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
