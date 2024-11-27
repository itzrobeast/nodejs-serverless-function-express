import express from 'express';
import fetch from 'node-fetch';
import OpenAI from 'openai';

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Webhook verification
router.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

  if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
    console.log('Verification successful:', challenge);
    return res.status(200).send(challenge);
  }

  return res.status(403).send('Verification failed');
});

// Handle Webhook Events
router.post('/', async (req, res) => {
  try {
    const body = req.body;

    if (!body || typeof body !== 'object') {
      console.error('Invalid webhook payload:', body);
      return res.status(400).json({ error: 'Invalid payload structure' });
    }

    // Process each entry in the webhook event
    const tasks = body.entry.map(async (entry) => {
      if (entry.messaging) {
        for (const message of entry.messaging) {
          await processMessagingEvent(message);
        }
      }
    });

    await Promise.all(tasks);
    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    console.error('Error processing webhook entries:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
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
      throw new Error(`Failed to send message: ${errorText}`);
    }

    console.log('Message successfully sent to Instagram user.');
  } catch (error) {
    console.error('Error in sendInstagramMessage:', error);
    throw error;
  }
}

// Process messaging events
async function processMessagingEvent(message) {
  try {
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
      if (!responseMessage) throw new Error('Invalid OpenAI response');

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

export default router;
