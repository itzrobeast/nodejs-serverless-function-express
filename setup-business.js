import express from 'express';

const router = express.Router();

// Health Check Route
router.get('/health', (req, res) => {
  console.log('[DEBUG] Health check route hit');
  res.status(200).json({ status: 'Healthy' });
});

// POST /setup-business handler
router.post('/', (req, res) => {
  try {
    console.log('[DEBUG] POST /setup-business hit with body:', req.body);

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
    console.error('[ERROR] /setup-business:', error.message);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

export default router;
