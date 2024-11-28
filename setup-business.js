import express from 'express';

const router = express.Router();

router.post('/', (req, res) => {
  try {
    console.log('[DEBUG] POST /setup-business Hit:', req.body);

    const { platform, businessName, ownerName, contactEmail } = req.body;

    // Validate fields
    if (!platform || !businessName || !ownerName || !contactEmail) {
      return res.status(400).json({
        error: 'Missing required fields',
        receivedData: req.body,
      });
    }

    res.json({
      message: 'Business setup successful',
      data: { platform, businessName, ownerName, contactEmail },
    });
  } catch (error) {
    console.error('[ERROR] POST /setup-business:', error.message);
    res.status(400).json({
      error: 'Invalid request',
      details: error.message,
    });
  }
});

export default router;
