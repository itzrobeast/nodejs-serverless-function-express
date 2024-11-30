import express from 'express';
import supabase from './supabaseClient'; // Import Supabase client

const router = express.Router();

// POST Handler for /setup-business
router.post('/', async (req, res) => {
  try {
    const { appId, platform, businessName, ownerName, contactEmail, locations, insurancePolicies, objections } = req.body;

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
    const supportedPlatforms = ['Web', 'Mobile', 'Desktop'];

    // Validate platform
    if (!supportedPlatforms.includes(platform)) {
      return res.status(400).json({
        error: 'Unsupported platform',
        receivedPlatform: platform,
        supportedPlatforms,
      });
    }

    // Validate required fields
    if (!businessName || !ownerName || !contactEmail) {
      return res.status(400).json({
        error: 'Missing required fields',
        requiredFields: ['businessName', 'ownerName', 'contactEmail'],
        receivedData: req.body,
      });
    }

    // Insert business into Supabase
    const { data, error } = await supabase.from('businesses').insert([
      {
        name: businessName,
        owner_id: ownerName, // Assuming ownerName maps to owner_id
        locations,
        insurance_policies: insurancePolicies || {}, // Default to empty object
        objections: objections || {}, // Default to empty object
        contact_email: contactEmail,
      },
    ]);

    if (error) {
      console.error('[ERROR] Failed to insert business:', error.message);
      return res.status(500).json({
        error: 'Database error',
        details: error.message,
      });
    }

    console.log('[DEBUG] Business added successfully:', data);

    // Return success response
    res.status(201).json({
      message: 'Business setup successful',
      business: data,
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
