import express from 'express';
import supabase from './supabaseClient.js'; // Import Supabase client

const router = express.Router();

// POST Handler for /setup-business
router.post('/', async (req, res) => {
  try {
    const {
      appId,
      platform,
      businessName,
      ownerId,
      contactEmail,
      locations,
      insurancePolicies,
      objections,
      aiKnowledgeBase,
    } = req.body;

    console.log('[DEBUG] POST /setup-business hit:', req.body);

    // Validate required fields
    if (!appId || !businessName || !ownerId || !contactEmail || !platform) {
      console.error('[ERROR] Missing required fields');
      return res.status(400).json({
        error: 'Missing required fields',
        requiredFields: ['appId', 'platform', 'businessName', 'ownerId', 'contactEmail'],
        receivedData: req.body,
      });
    }

    // Validate appId
    if (appId !== 'milaVerse') {
      console.error('[ERROR] Invalid appId:', appId);
      return res.status(400).json({ error: 'Unknown application', appId });
    }

    // Validate platform
    const supportedPlatforms = ['Web', 'Mobile', 'Desktop'];
    if (!supportedPlatforms.includes(platform)) {
      console.error('[ERROR] Unsupported platform:', platform);
      return res.status(400).json({
        error: 'Unsupported platform',
        receivedPlatform: platform,
        supportedPlatforms,
      });
    }

    
const ownerId = req.body.ownerId || req.body.user?.id;

if (!appId || !businessName || !ownerId || !contactEmail || !platform) {
  console.error('[ERROR] Missing required fields');
  return res.status(400).json({
    error: 'Missing required fields',
    requiredFields: ['appId', 'platform', 'businessName', 'ownerId', 'contactEmail'],
    receivedData: req.body,
  });
}

    
    // Check if the business already exists for this ownerId
    const { data: existingBusiness, error: fetchError } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', ownerId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('[ERROR] Database fetch error:', fetchError.message);
      throw new Error('Failed to fetch existing business data');
    }

    if (existingBusiness) {
      console.log('[DEBUG] Business already exists:', existingBusiness);
      return res.status(200).json({
        message: 'Business already exists',
        data: existingBusiness,
      });
    }

    // Insert new business into Supabase
    const { data, error: insertError } = await supabase.from('businesses').insert([
      {
        name: businessName,
        owner_id: ownerId,
        contact_email: contactEmail,
        locations: locations || [], // Default to empty array
        insurance_policies: insurancePolicies || {}, // Default to empty object
        objections: objections || {}, // Default to empty object
        ai_knowledge_base: aiKnowledgeBase || '', // Default to empty string
        platform, // Save platform
      },
    ]);

    if (insertError) {
      console.error('[ERROR] Failed to insert business:', insertError.message);
      return res.status(500).json({
        error: 'Database error',
        details: insertError.message,
      });
    }

    console.log('[DEBUG] Business added successfully:', data);

    // Return success response
    return res.status(201).json({
      message: 'Business setup successful',
      business: data,
    });
  } catch (error) {
    console.error('[ERROR] /setup-business:', error.message);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message,
    });
  }
});

// Optional health check for debugging
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'Setup-Business endpoint is healthy!' });
});

export default router;
