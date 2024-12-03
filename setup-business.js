import express from 'express';
import supabase from './supabaseClient.js'; // Import Supabase client

const router = express.Router();

// Function to determine the platform from the request headers
function getPlatform(req) {
  const userAgent = req.headers['user-agent'] || '';
  if (/mobile/i.test(userAgent)) {
    return 'Mobile';
  } else if (/tablet/i.test(userAgent)) {
    return 'Tablet';
  }
  return 'Web';
}

// POST Handler for /setup-business
router.post('/', async (req, res) => {
  try {
    const {
      appId,
      user, // Extract the user object from req.body
      accessToken,
      businessName,
      contactEmail,
      locations,
      insurancePolicies,
      objections,
      aiKnowledgeBase,
      pageId,
    } = req.body;

    console.log('[DEBUG] POST /setup-business hit:', req.body);

    // Derive platform dynamically BEFORE any reference
    const platform = getPlatform(req);
    console.log('[DEBUG] Detected platform:', platform);

    // Validate required fields
    if (!appId || !businessName || !user?.id || !contactEmail) {
      console.error('[ERROR] Missing required fields');
      return res.status(400).json({
        error: 'Missing required fields',
        requiredFields: ['appId', 'businessName', 'user.id', 'contactEmail'],
        receivedData: req.body,
      });
    }

    // Validate appId
    if (appId !== 'milaVerse') {
      console.error('[ERROR] Invalid appId:', appId);
      return res.status(400).json({ error: 'Unknown application', appId });
    }

    // Check if user exists in the 'users' table
    const { data: existingUser, error: userFetchError } = await supabase
      .from('users')
      .select('*')
      .eq('fb_id', user.id)
      .single();

    if (userFetchError && userFetchError.code !== 'PGRST116') {
      throw new Error('Failed to fetch existing user data');
    }

    if (!existingUser) {
      // Insert new user into 'users' table
      const { error: userInsertError } = await supabase.from('users').insert([
        {
          fb_id: user.id,
          name: user.name,
          email: user.email,
        },
      ]);

      if (userInsertError) {
        throw new Error('Failed to insert user data');
      }
    }

    // Check if the business already exists for this ownerId
    const { data: existingBusiness, error: fetchError } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', user.id)
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



    console.log('[DEBUG] Payload for Supabase insert:', {
  name: businessName,
  owner_id: user.id,
  page_id: pageId, // Should log the correct value
  contact_email: contactEmail,
  locations,
  insurance_policies,
  objections,
  ai_knowledge_base: aiKnowledgeBase,
  platform,
});

    // Insert new business into Supabase
    const { data, error: insertError } = await supabase.from('businesses').insert([
  {
    name: businessName,
    owner_id: user.id, // From the `user` object in the request
    page_id: pageId || null, // Add `pageId` from the request body or default to null
    access_token: accessToken || null, // Add `accessToken` from the request body or default to null
    contact_email: contactEmail,
    locations: locations || [], // Default to empty array if not provided
    insurance_policies: insurancePolicies || {}, // Default to empty object if not provided
    objections: objections || {}, // Default to empty object if not provided
    ai_knowledge_base: aiKnowledgeBase || '', // Default to an empty string if not provided
    platform, // Use the platform determined dynamically
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
