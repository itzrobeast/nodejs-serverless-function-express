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
      businessName,
      ownerId = req.body.user?.id,
      contactEmail,
      locations,
      insurancePolicies,
      objections,
      aiKnowledgeBase,
    } = req.body;

    console.log('[DEBUG] POST /setup-business hit:', req.body);

    // Derive platform dynamically BEFORE any reference
    const platform = getPlatform(req);
    console.log('[DEBUG] Detected platform:', platform);

    // Validate required fields
    if (!appId || !businessName || !ownerId || !contactEmail) {
      console.error('[ERROR] Missing required fields');
      return res.status(400).json({
        error: 'Missing required fields',
        requiredFields: ['appId', 'businessName', 'ownerId', 'contactEmail'],
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
        locations: locations || [],
        insurance_policies: insurancePolicies || {},
        objections: objections || {},
        ai_knowledge_base: aiKnowledgeBase || '',
        platform, // Use the platform determined by getPlatform(req)
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
