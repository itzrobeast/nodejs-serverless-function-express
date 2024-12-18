import express from 'express';
import supabase from './supabaseClient.js';
import fetch from 'node-fetch'; // For sending replies
import assistantHandler from './assistant.js'; // Centralized assistant logic

const router = express.Router();

const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// Utility: Extract Dynamic Fields (email, phone, location)
function extractDynamicFields(text) {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const phoneRegex = /(\+?\d{1,4}[\s-]?)?(\(?\d{3}\)?[\s-]?)?\d{3}[\s-]?\d{4}/;
  const locationRegex = /(city|address|location)[:\s]+([\w\s,]+)/i;

  const email = text.match(emailRegex)?.[0] || null;
  const phoneNumber = text.match(phoneRegex)?.[0] || null;
  const location = text.match(locationRegex)?.[2]?.trim() || null;

  return { email, phoneNumber, location };
}

// Helper: Resolve Business ID by Page ID
async function resolveBusinessIdByPageId(pageId) {
  try {
    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('id')
      .eq('page_id', pageId)
      .single();

    if (businessError || !businessData) {
      console.error('[ERROR] Business not found for page_id:', pageId);
      return null;
    }

    return businessData.id;
  } catch (err) {
    console.error('[ERROR] Failed to resolve business_id by page_id:', err.message);
    return null;
  }
}

// Helper: Send Reply to Instagram User
async function sendInstagramMessage(recipientId, message) {
  try {
    if (!PAGE_ACCESS_TOKEN) throw new Error('PAGE_ACCESS_TOKEN not set.');

    const response = await fetch(
      `https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
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
      return;
    }

    console.log('[DEBUG] Message sent successfully.');
  } catch (error) {
    console.error('[ERROR] Failed to send Instagram message:', error.message);
  }
}

// Process Messaging Event
async function processMessagingEvent(message) {
  try {
    const text = message?.message?.text;
    const senderId = message?.sender?.id;
    const recipientId = message?.recipient?.id;

    if (!text || !senderId || !recipientId) {
      console.warn('[WARN] Missing text, senderId, or recipientId.');
      return;
    }

    console.log('[DEBUG] Received message:', text);

    // Resolve business_id
    const businessId = await resolveBusinessIdByPageId(recipientId);
    if (!businessId) {
      console.warn('[WARN] Business ID not found for recipient:', recipientId);
      return;
    }

    // Extract dynamic fields
    const { email, phoneNumber, location } = extractDynamicFields(text);

    // Insert or update the conversation
    const { error: insertError } = await supabase.from('instagram_conversations').insert([
      {
        business_id: businessId,
        sender_id: senderId,
        recipient_id: recipientId,
        message: text,
        message_type: 'received',
        email,
        phone_number: phoneNumber,
        location,
      },
    ]);

    if (insertError) {
      console.error('[ERROR] Failed to upsert conversation:', insertError.message);
      return;
    }

    console.log('[DEBUG] Conversation saved successfully.');

    // Pass to assistant for response
    const assistantResponse = await assistantHandler({
      userMessage: text,
      recipientId: senderId,
      platform: 'instagram',
      businessId,
    });

    if (assistantResponse?.message) {
      await sendInstagramMessage(senderId, assistantResponse.message);
    } else {
      console.warn('[WARN] No response from assistant.');
    }
  } catch (err) {
    console.error('[ERROR] Failed to process messaging event:', err.message);
  }
}

// Webhook Verification
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[DEBUG] Webhook verified successfully.');
    res.status(200).send(challenge);
  } else {
    console.error('[ERROR] Webhook verification failed.');
    res.sendStatus(403);
  }
});

// Webhook Event Handler
router.post('/', async (req, res) => {
  try {
    const body = req.body;

    if (body.object === 'instagram') {
      for (const entry of body.entry) {
        if (entry.messaging) {
          for (const message of entry.messaging) {
            await processMessagingEvent(message);
          }
        }
      }
    } else {
      console.log('[DEBUG] Unhandled object type:', body.object);
    }

    res.status(200).send('EVENT_RECEIVED');
  } catch (err) {
    console.error('[ERROR] Failed to process webhook events:', err.message);
    res.status(500).send('Internal Server Error');
  }
});

export default router;
