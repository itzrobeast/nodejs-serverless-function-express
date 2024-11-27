import express from 'express';

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
router.post('/', (req, res) => {
  try {
    console.log('[DEBUG] Received payload:', JSON.stringify(req.body, null, 2));

    if (!req.body || !req.body.entry || !Array.isArray(req.body.entry)) {
      console.error('[ERROR] Invalid webhook payload:', req.body);
      return res.status(400).json({ error: 'Invalid payload structure' });
    }

    // Log each entry for verification
    req.body.entry.forEach((entry, index) => {
      console.log(`[DEBUG] Entry ${index}:`, JSON.stringify(entry, null, 2));
    });

    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    console.error('[ERROR] Webhook processing failed:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
