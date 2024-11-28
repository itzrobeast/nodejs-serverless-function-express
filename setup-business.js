import express from 'express';

const router = express.Router();

// POST /setup-business
router.post('/', (req, res) => {
  try {
    console.log('[DEBUG] Business Setup Route Hit');
    const { platform, businessName, ownerName, contactEmail } = req.body;

    if (!platform || !businessName || !ownerName || !contactEmail) {
      return res.status(400).json({
        error: 'Missing required fields',
        receivedData: req.body,
      });
    }

    res.status(200).json({
      message: 'Business setup successful',
      data: { platform, businessName, ownerName, contactEmail },
    });
  } catch (error) {
    console.error('[ERROR] Business Setup Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Health check for debugging
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'Setup Business API is healthy!' });
});

export default router;
