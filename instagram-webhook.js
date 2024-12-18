import express from 'express';
import fetch from 'node-fetch';
import supabase from './supabaseClient.js';
import assistantHandler from './assistant.js';

const router = express.Router();

const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

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
      console.error('Error sending message to Instagram:', errorText);
      throw new Error(`Failed to send Instagram message: ${response.statusText}`);
    }

    console.log('Message sent to Instagram user successfully.');
    return await response.json();
  } catch (error) {
    console.error('[ERROR] Failed to send Instagram message:', error);
    throw error;
  }
}

/**
 * Resolve business_id using recipient (Instagram Business Account ID).
 */
async function resolveBusinessIdByInstagramId(recipientId) {
  try {
    const { data: business, error } = await supabase
      .from('businesses')
      .select('id')
      .eq('ig_id', recipientId)
      .single();

    if (error) {
      console.error(`[ERROR] Failed to fetch business for ig_id: ${recipientId}`, error.message);
      return null;
    }

    if (!business) {
      console.warn(`[WARN] No business found for ig_id: ${recipientId}`);
      return null;
    }

    console.log(`[DEBUG] Resolved business_id: ${business.id} for recipient: ${recipientId}`);
    return business.id;
  } catch (err) {
    console.error('[ERROR] Error while resolving business_id by Instagram ID:', err.message);
    return null;
  }
}

/**
 * Process individual messaging events from the Instagram webhook callback.
 */
async function processMessagingEvent(message) {
  try {
    console.log('[DEBUG] Full message object:', JSON.stringify(message, null, 2));

    const userMessage = message?.message?.text;
    const recipientId = message?.recipient?.id;
    const senderId = message?.sender?.id;
    const messageType = 'received';

    console.log('[DEBUG] Extracted message details:', {
      userMessage,
      recipientId,
      senderId,
      messageType,
    });

    if (!userMessage || !recipientId || !senderId) {
      console.error('[ERROR] Missing message, recipientId, or senderId.');
      return;
    }

    // Resolve business_id using the recipientId (ig_id)
    const businessId = await resolveBusinessIdByInstagramId(recipientId);
    if (!businessId) {
      console.error(`[ERROR] Business not found for recipient: ${recipientId}`);
      return;
    }

    console.log(`[DEBUG] Resolved business_id: ${businessId}`);

    // Insert the conversation into the Instagram Conversations table
    const { error: insertError } = await supabase
      .from('instagram_conversations')
      .insert([
        {
          business_id: businessId,
          sender_id: senderId,
          recipient_id: recipientId,
          message: userMessage,
          message_type: messageType,
          created_at: new Date().toISOString(),
        },
      ]);

    if (insertError) {
      console.error('[ERROR] Failed to insert Instagram conversation:', insertError.message);
      return;
    }

    console.log('[DEBUG] Instagram conversation inserted successfully.');

    // Optional: Respond to the sender (if applicable)
    await sendInstagramMessage(senderId, 'Thank you for your message! We will get back to you shortly.');
  } catch (error) {
    console.error('[ERROR] Failed to process messaging event:', error.message);
    throw error;
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
  const body = req.body;

  if (!body) {
    console.error('[ERROR] Received empty body.');
    return res.status(400).send('Invalid request body.');
  }

  try {
    // Handle Messaging Events (object === 'instagram')
    if (body.object === 'instagram') {
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
    } else {
      console.log('Unhandled webhook event type:', body.object);
    }

    // Respond with 200 OK to acknowledge receipt of the event
    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    console.error('[ERROR] Failed to process webhook events:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
