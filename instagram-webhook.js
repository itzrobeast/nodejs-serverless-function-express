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
router.post('/', async (req, res, next) => {
  try {
    const body = req.body;

    if (!body || typeof body !== 'object') {
      console.error('Invalid webhook payload:', body);
      return res.status(400).json({ error: 'Invalid payload structure' });
    }

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
    next(error); // Pass error to error-handling middleware
  }
});

async function processMessagingEvent(message) {
  console.log('Processing Instagram message:', message);
  // Add logic to process events (omitted for brevity)
}

export default router;
