import express from 'express';
import supabase from './supabaseClient.js';// Import Supabase client

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

    
 try {
    // Check if the business already exists for this owner_id
    const { data: existingBusiness, error: fetchError } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', owner_id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // 'PGRST116' means no rows were found, so it's not an actual error
      throw new Error('Failed to fetch existing business data');
    }

    if (existingBusiness) {
      // If the business exists, return it
      return res.status(200).json({
        message: 'Business data already exists',
        data: existingBusiness,
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
