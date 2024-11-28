import express from 'express';

const router = express.Router();

// POST Handler for /setup-business
router.post('/', (req, res) => {
  try {
    const { platform, businessName, ownerName, contactEmail } = req.body;

    console.log('[DEBUG] POST /setup-business hit:', req.body);

 // Validate appId
    if (!appId) {
      console.error('[ERROR] Missing appId in request body');
      return res.status(400).json({ error: 'appId is required' });
    }

    if (appId !== 'milaVerse') {
      return res.status(400).json({
        error: 'Unknown application',
        appId,
      });
    }
    
 // Define supported platforms
    const supportedPlatforms = ['Web', 'Mobile', 'Desktop']; // Add other supported platforms if needed

    // Validate the platform field
    if (!supportedPlatforms.includes(platform)) {
      return res.status(400).json({
        error: 'Unsupported platform',
        receivedPlatform: platform,
        supportedPlatforms,
      });
    }



    
    // Validate fields
    if (!platform || !businessName || !ownerName || !contactEmail) {
      return res.status(400).json({
        error: 'Missing required fields',
        receivedData: req.body,
      });
    }

    // Return success response
    res.status(200).json({
      message: 'Business setup successful',
      data: { platform, businessName, ownerName, contactEmail },
    });
  } catch (error) {
    console.error('[ERROR] /setup-business:', error.message);
    res.status(500).json({
      error: 'Something went wrong',
      details: error.message,
    });
  }
});

// Optional health check for debugging
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'Setup-Business endpoint is healthy!' });
});

export default router;
