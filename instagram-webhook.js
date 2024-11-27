import express from 'express';

const router = express.Router();

// Debugging Middleware
router.use((req, res, next) => {
  console.log(`[DEBUG] Instagram Webhook middleware hit: ${req.method} ${req.url}`);
  next();
});

// Webhook Verification
router.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

  if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
    console.log('[DEBUG] Verification successful:', challenge);
    return res.status(200).send(challenge);
  }

  console.error('[ERROR] Verification failed: Invalid mode or token');
  return res.status(403).send('Verification failed');
});

// Handle Webhook Events
router.post('/', (req, res) => {
  try {
    console.log('[DEBUG] Received payload:', JSON.stringify(req.body, null, 2));

    if (!req.body || !Array.isArray(req.body.entry)) {
      console.error('[ERROR] Invalid webhook payload:', req.body);
      return res.status(400).json({ error: 'Invalid payload structure' });
    }

    // Iterate through the entries in the payload
    req.body.entry.forEach((entry, index) => {
      console.log(`[DEBUG] Processing entry ${index}:`, JSON.stringify(entry, null, 2));

      if (entry.messaging) {
        entry.messaging.forEach((message, messageIndex) => {
          console.log(`[DEBUG] Message ${messageIndex}:`, JSON.stringify(message, null, 2));
          // Placeholder for processing messages
          console.log('[INFO] Message processing logic goes here.');
        });
      } else {
        console.log(`[INFO] No messaging events in entry ${index}`);
      }
    });

    // Respond with a success message
    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    console.error('[ERROR] Webhook processing failed:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
