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

    console.log('[DEBUG] Message sent successfully to Instagram user.');
    return await response.json();
  } catch (error) {
    console.error('[ERROR] Failed to send Instagram message:', error);
    throw error;
  }
}

/**
 * Resolve business_id using Instagram Business Account ID.
 */
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

    console.log(`[DEBUG] Resolved business_id: ${business.id} for Instagram ID: ${instagramId}`);
    return business.id;
  } catch (err) {
    console.error('[ERROR] Error while resolving business_id by Instagram ID:', err.message);
    return null;
  }
}

/**
 * Process individual messaging events from the Instagram webhook callback.
 */
/**
 * Process individual messaging events from the Instagram webhook callback.
 */
async function processMessagingEvent(message) {
  try {
    console.log('[DEBUG] Full message object:', JSON.stringify(message, null, 2));

    // Identify the type of event
    if (message.message) {
      // It's a message event
      const userMessage = message.message.text;
      const senderId = message.sender.id;
      const recipientId = message.recipient.id;
      const isEcho = message.message.is_echo || false;

      // Determine message type based on is_echo flag
      const messageType = isEcho ? 'sent' : 'received';

      if (!senderId || !recipientId) {
        console.error('[ERROR] Missing senderId or recipientId.');
        return;
      }

      // Map IDs based on message type
      let businessInstagramId;
      let customerId;
      let targetId; // The ID to send responses to

      if (messageType === 'received') {
        // Message received from customer to business
        businessInstagramId = recipientId;
        customerId = senderId;
        targetId = customerId;
      } else if (messageType === 'sent') {
        // Message sent from business to customer
        businessInstagramId = senderId;
        customerId = recipientId;
        targetId = customerId;
      } else {
        console.warn('[WARN] Unknown message type:', messageType);
        return;
      }

      console.log('[DEBUG] Determined messageType:', messageType);
      console.log('[DEBUG] businessInstagramId:', businessInstagramId);
      console.log('[DEBUG] customerId:', customerId);
      console.log('[DEBUG] targetId:', targetId);

      // Resolve business ID
      const businessId = await resolveBusinessIdByInstagramId(businessInstagramId);
      if (!businessId) {
        console.error('[ERROR] Could not resolve business ID.');
        return;
      }

      // Prepare the message content for database insertion
      let messageContent = userMessage || '';
      let messageAttachments = [];

      if (message.message.attachments && Array.isArray(message.message.attachments)) {
        messageAttachments = message.message.attachments.map((attachment) => ({
          type: attachment.type,
          payload: attachment.payload,
        }));
        // Optionally, you can serialize attachments as JSON string
        messageContent += ` Attachments: ${JSON.stringify(messageAttachments)}`;
        console.log('[DEBUG] Message contains attachments:', messageAttachments);
      }

      // Insert the conversation into the database
      const { error: conversationError } = await supabase
        .from('instagram_conversations')
        .insert([
          {
            business_id: businessId,
            sender_id: customerId, // Always the customer
            recipient_id: businessId, // Always the business
            message: messageContent, // Include attachments if any
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

      // If the message is received and contains text, respond using the assistant
      if (messageType === 'received') {
        if (!userMessage) {
          console.warn('[WARN] Received message has no text content.');
          // Optionally, handle messages with attachments here
          return;
        }

        const assistantResponse = await assistantHandler({
          userMessage,
          recipientId: targetId, // Send the response to the customer
          platform: 'instagram',
          businessId,
        });

        if (assistantResponse && assistantResponse.message) {
          await sendInstagramMessage(targetId, assistantResponse.message);
          console.log('[DEBUG] Assistant response sent to customer.');
        } else {
          console.warn('[WARN] Assistant generated no response.');
        }
      }
    } else if (message.read) {
      // It's a read receipt
      console.log('[INFO] Read receipt received:', message.read);
      // Optionally, handle read receipts here
    } else if (message.delivery) {
      // It's a delivery receipt
      console.log('[INFO] Delivery receipt received:', message.delivery);
      // Optionally, handle delivery receipts here
    } else {
      console.warn('[WARN] Unknown messaging event type:', message);
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
