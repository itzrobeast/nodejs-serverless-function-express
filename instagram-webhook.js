import express from 'express';
import fetch from 'node-fetch';
import supabase from './supabaseClient.js';
import assistantHandler from './assistant.js';

const router = express.Router();

const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN;

/**
 * Helper: Send a direct message to an Instagram user
 */
async function sendInstagramMessage(recipientId, message) {
  try {
    console.log(`[DEBUG] Sending message to Instagram user ${recipientId}: "${message}"`);

    const response = await fetch(
      `https://graph.facebook.com/v14.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
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

    console.log('[DEBUG] Message sent to Instagram user successfully.');
    return await response.json();
  } catch (error) {
    console.error('[ERROR] Failed to send Instagram message:', error);
    throw error;
  }
}

/**
 * Helper: Resolve business_id using recipient_id (Instagram Business Account ID or Page ID)
 */
async function resolveBusinessIdByRecipient(recipientId) {
  try {
    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('id')
      .or(`ig_id.eq.${recipientId},page_id.eq.${recipientId}`)
      .single();

    if (businessError || !businessData) {
      console.warn('[WARN] Business ID not found for recipient:', recipientId);
      return null;
    }

    console.log(`[DEBUG] Resolved business_id: ${businessData.id} for recipient: ${recipientId}`);
    return businessData.id;
  } catch (error) {
    console.error('[ERROR] Error while resolving business_id by recipient:', error.message);
    return null;
  }
}

/**
 * Helper: Insert Instagram conversation into the database
 */
async function upsertInstagramConversation({ businessId, senderId, recipientId, message, messageType, attachments }) {
  try {
    const { data, error } = await supabase.from('instagram_conversations').insert({
      business_id: businessId,
      sender_id: senderId,
      recipient_id: recipientId,
      message,
      message_type: messageType,
      attachments,
    });

    if (error) {
      console.error('[ERROR] Failed to insert Instagram conversation:', error.message);
      throw new Error(`Failed to insert Instagram conversation: ${error.message}`);
    }

    console.log('[DEBUG] Instagram conversation saved successfully:', data);
  } catch (error) {
    console.error('[ERROR] Failed to upsert Instagram conversation:', error.message);
    throw error;
  }
}

/**
 * Process individual messaging events
 */
async function processMessagingEvent(message) {
  try {
    console.log('[DEBUG] Full message object:', JSON.stringify(message, null, 2));

    const userMessage = message?.message?.text;
    const recipientId = message?.recipient?.id; // Our Instagram business account ID
    const senderId = message?.sender?.id;      // The user interacting with the bot
    const messageType = message?.message ? 'received' : 'sent';
    const attachments = message?.message?.attachments || null;

    console.log('[DEBUG] Extracted message details:', { userMessage, recipientId, senderId, messageType });

    if (!recipientId || !senderId) {
      console.error('[ERROR] Missing recipient_id or sender_id. Skipping event processing.');
      return;
    }

    // Resolve business_id
    const businessId = await resolveBusinessIdByRecipient(recipientId);

    if (!businessId) {
      console.warn('[WARN] Could not resolve business ID for recipient:', recipientId);
      await sendInstagramMessage(senderId, 'We could not process your message. Please try again later.');
      return;
    }

    // Save the conversation to the database
    await upsertInstagramConversation({
      businessId,
      senderId,
      recipientId,
      message: userMessage,
      messageType,
      attachments,
    });

    // Forward message to assistant for response
    if (userMessage) {
      const assistantResponse = await assistantHandler({
        userMessage,
        recipientId: senderId,
        platform: 'instagram',
        businessId,
      });

      if (assistantResponse && assistantResponse.message) {
        console.log('[DEBUG] Assistant response:', assistantResponse.message);
        await sendInstagramMessage(senderId, assistantResponse.message);
      } else {
        console.warn('[WARN] No valid response from assistant.');
      }
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
    console.log('[INFO] Instagram Webhook verified successfully.');
    res.status(200).send(challenge);
  } else {
    console.error('[ERROR] Instagram Webhook verification failed.');
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
    // Handle Messaging Events
    if (body.object === 'instagram') {
      for (const entry of body.entry) {
        console.log('[DEBUG] Processing instagram entry:', entry);

        if (entry.messaging && Array.isArray(entry.messaging)) {
          for (const message of entry.messaging) {
            await processMessagingEvent(message);
          }
        } else {
          console.warn('[WARN] No messaging events found in instagram entry.');
        }
      }
    }

    // Acknowledge receipt of the event
    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    console.error('[ERROR] Failed to process webhook events:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
