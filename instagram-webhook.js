import express from 'express';
import fetch from 'node-fetch';
import supabase from './supabaseClient.js'; // Your Supabase client
import assistantHandler from './assistant.js'; // Centralized assistant logic

const router = express.Router();

// Helper: Ensure Partition Exists
async function ensurePartition(businessId) {
  try {
    const checkPartitionQuery = `
      SELECT relname FROM pg_class 
      WHERE relname = 'instagram_conversations_${businessId}';
    `;

    const { data: partitionExists, error: checkError } = await supabase.rpc('run_sql', {
      sql: checkPartitionQuery,
    });

    if (!partitionExists?.length && !checkError) {
      console.log(`[INFO] Creating partition for business_id: ${businessId}`);

      const createPartitionQuery = `
        CREATE TABLE instagram_conversations_${businessId}
        PARTITION OF instagram_conversations
        FOR VALUES IN (${businessId});
      `;

      const { error: partitionError } = await supabase.rpc('run_sql', {
        sql: createPartitionQuery,
      });

      if (partitionError) {
        console.error('[ERROR] Failed to create partition:', partitionError.message);
        throw new Error(partitionError.message);
      }
    } else if (checkError) {
      console.error('[ERROR] Failed to check partition existence:', checkError.message);
      throw new Error(checkError.message);
    }
  } catch (err) {
    console.error('[ERROR] Error ensuring partition:', err.message);
    throw err;
  }
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

    console.log(`[DEBUG] Resolved business_id: ${businessData.id} for page_id: ${pageId}`);
    return businessData.id;
  } catch (err) {
    console.error('[ERROR] Error resolving business ID by page ID:', err.message);
    return null;
  }
}

// Helper: Process Messaging Event
async function processMessagingEvent(message) {
  try {
    console.log('[DEBUG] Full message object:', JSON.stringify(message, null, 2));

    const userMessage = message?.message?.text;
    const recipientId = message?.recipient?.id;
    const senderId = message?.sender?.id;
    const messageType = 'received';

    if (!userMessage || !recipientId || !senderId) {
      console.error('[ERROR] Missing essential message details:', {
        userMessage,
        recipientId,
        senderId,
      });
      return;
    }

    console.log('[DEBUG] Extracted message details:', {
      userMessage,
      recipientId,
      senderId,
      messageType,
    });

    const businessId = await resolveBusinessIdByPageId(recipientId);

    if (!businessId) {
      console.error('[ERROR] Business not found for recipient:', recipientId);
      return;
    }

    // Ensure partition exists
    await ensurePartition(businessId);

    // Insert conversation into the table
    const { error: insertError } = await supabase.from('instagram_conversations').insert([
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
      throw new Error(insertError.message);
    }

    console.log('[DEBUG] Instagram conversation inserted successfully.');

    // Pass to the assistant for processing
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
      console.warn('[WARN] Assistant response is missing or invalid.');
    }
  } catch (err) {
    console.error('[ERROR] Failed to process messaging event:', err.message);
  }
}

// Helper: Send Instagram Message
async function sendInstagramMessage(recipientId, message) {
  try {
    const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
    if (!PAGE_ACCESS_TOKEN) throw new Error('Missing PAGE_ACCESS_TOKEN.');

    const response = await fetch(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ERROR] Failed to send Instagram message:', errorText);
      throw new Error(response.statusText);
    }

    console.log('[DEBUG] Message sent successfully.');
    return await response.json();
  } catch (err) {
    console.error('[ERROR] Failed to send Instagram message:', err.message);
  }
}

// Webhook Verification Endpoint
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
    console.log('[INFO] Instagram Webhook verified successfully.');
    res.status(200).send(challenge);
  } else {
    console.log('[ERROR] Instagram Webhook verification failed.');
    res.sendStatus(403);
  }
});

// Webhook Event Handler
router.post('/', async (req, res) => {
  const body = req.body;

  if (!body) {
    console.error('[ERROR] Received empty body.');
    return res.status(400).send('Invalid request body.');
  }

  try {
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
      console.warn('[WARN] Unhandled webhook event type:', body.object);
    }

    res.status(200).send('EVENT_RECEIVED');
  } catch (err) {
    console.error('[ERROR] Failed to process webhook events:', err.message);
    res.status(500).send('Internal Server Error');
  }
});

export default router;
