// setup-business.js
import express from 'express';

const router = express.Router();

// POST /setup-business handler
router.post('/', (req, res) => {
  try {
    const { platform, businessName, ownerName, contactEmail } = req.body;
    console.log('[DEBUG] Request Body:', req.body);

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
    res.status(500).json({ error: error.message });
  }
});

// Debug health check
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'Healthy' });
});

export default router;
