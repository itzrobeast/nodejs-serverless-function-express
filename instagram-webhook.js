import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

// Debugging: Log every request to this router
router.use((req, res, next) => {
  console.log(`[DEBUG] Instagram Webhook middleware hit: ${req.method} ${req.url}`);
  next();
});

// Webhook verification
router.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

  if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
    console.log('[DEBUG] Verification successful:', challenge);
    return res.status(200).send(challenge);
  }

  console.error('[ERROR] Verification failed');
  return res.status(403).send('Verification failed');
});

// Handle Webhook Events
router.post('/', async (req, res, next) => {
  try {
    const body = req.body;

    if (!body || typeof body !== 'object' || !body.entry) {
      console.error('[ERROR] Invalid webhook payload:', body);
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
    console.error('[ERROR] Webhook processing failed:', error.message);
    next(error);
  }
});

// Process individual messaging events
async function processMessagingEvent(message) {
  try {
    if (message.message && message.message.text) {
      const userMessage = message.message.text;
      console.log(`[DEBUG] Received message: "${userMessage}"`);

      const reply = `You said: "${userMessage}" - Thank you for messaging us!`;

      // Send reply to Instagram
      await sendReplyToInstagram(message.sender.id, reply);
    } else {
      console.log('[DEBUG] Unsupported message format:', message);
    }
  } catch (error) {
    console.error('[ERROR] Failed to process message:', error.message);
    throw error;
  }
}

// Send reply via Instagram Graph API
async function sendReplyToInstagram(senderId, reply) {
  const pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const url = 'https://graph.facebook.com/v17.0/me/messages';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pageAccessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: senderId },
        message: { text: reply },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ERROR] Failed to send message: ${errorText}`);
      throw new Error(errorText);
    }

    console.log(`[DEBUG] Reply sent successfully: "${reply}"`);
  } catch (error) {
    console.error(`[ERROR] Instagram API call failed: ${error.message}`);
    throw error;
  }
}

export default router;
