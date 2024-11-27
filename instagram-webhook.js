import express from 'express';

const router = express.Router();

router.use((req, res, next) => {
  console.log(`[DEBUG] Instagram Webhook middleware hit: ${req.method} ${req.url}`);
  next();
});



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
    next(error);
  }
});

async function processMessagingEvent(message) {
  try {
    // Check if the message has text
    if (message.message && message.message.text) {
      const userMessage = message.message.text;
      console.log(`[DEBUG] Received message: "${userMessage}"`);

      // Example: Send a predefined reply
      const reply = `You said: "${userMessage}" - Thank you for messaging us!`;

      // Mock function to send a reply via Meta API (replace this with real implementation)
      await sendReplyToInstagram(message.sender.id, reply);
    } else {
      console.log(`[DEBUG] Unsupported message format:`, message);
    }
  } catch (error) {
    console.error(`[ERROR] Failed to process message: ${error.message}`);
    throw error;
  }
}

// Helper function to send replies via the Instagram Graph API
async function sendReplyToInstagram(senderId, reply) {
  const pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const url = `https://graph.facebook.com/v17.0/me/messages`;

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
    throw new Error(`Failed to send message: ${errorText}`);
  }

  console.log(`[DEBUG] Reply sent successfully: "${reply}"`);
}


export default router;
