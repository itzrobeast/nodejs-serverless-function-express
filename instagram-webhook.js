import express from 'express';
import fetch from 'node-fetch';
import OpenAI from 'openai';

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Ensure JSON parsing
router.use(express.json());

// CORS Middleware
router.use((req, res, next) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://mila-verse.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Helper function to send Instagram messages
async function sendInstagramMessage(recipientId, message) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v17.0/me/messages?access_token=${process.env.INSTAGRAM_ACCESS_TOKEN}`,
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
      console.error('Error sending Instagram message:', errorText);
      throw new Error(`Failed to send message: ${errorText}`);
    }

    console.log('Message successfully sent to Instagram user:', recipientId);
  } catch (error) {
    console.error('Error in sendInstagramMessage:', error);
    throw error;
  }
}

// Process Instagram messaging events
async function processMessagingEvent(message) {
  try {
    if (!message) {
      console.warn('Received undefined message in event.');
      return;
    }

    console.log('Processing Instagram message:', JSON.stringify(message, null, 2));

    const userMessage = message.message?.text || null;
    const recipientId = message.sender?.id || null;

    if (userMessage && recipientId) {
      const openaiResponse = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are a helpful assistant responding to customer inquiries.' },
          { role: 'user', content: userMessage },
        ],
      });

      const responseMessage = openaiResponse.choices?.[0]?.message?.content;
      if (!responseMessage) {
        console.error('Invalid OpenAI response:', openaiResponse);
        throw new Error('Invalid OpenAI response');
      }

      await sendInstagramMessage(recipientId, responseMessage);
    } else if (message.message?.is_deleted) {
      console.log('Skipping deleted message:', message.message.mid);
    } else {
      console.warn('Unhandled messaging event:', message);
    }
  } catch (error) {
    console.error('Error processing message:', error);
  }
}

// Webhook Verification Endpoint
router.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

  if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
    console.log('Webhook verification successful.');
    return res.status(200).send(challenge);
  }

  console.error('Webhook verification failed.');
  return res.status(403).send('Verification failed');
});

// Webhook Event Handler
router.post('/', async (req, res) => {
  try {
    console.log('Incoming webhook payload:', req.body);

    const { entry } = req.body;
    if (!Array.isArray(entry)) {
      console.error('Invalid payload structure:', req.body);
      return res.status(400).json({ error: 'Invalid payload structure' });
    }

    const tasks = entry.map(async (entryItem) => {
      if (entryItem.messaging && Array.isArray(entryItem.messaging)) {
        for (const message of entryItem.messaging) {
          await processMessagingEvent(message);
        }
      } else {
        console.warn('No messaging field in entry:', entryItem);
      }
    });

    await Promise.all(tasks);
    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
