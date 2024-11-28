import express from 'express';

const router = express.Router();

router.post('/', (req, res) => {
  try {
    const { platform, businessName, ownerName, contactEmail } = req.body;
    console.log('[DEBUG] Request Body:', req.body);

    if (!platform || !businessName || !ownerName || !contactEmail) {
      throw new Error('Missing required fields');
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

// Health check
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'Healthy' });
});

export default router;
