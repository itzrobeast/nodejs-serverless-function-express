import express from 'express';
import supabase from './supabaseClient.js';

const router = express.Router();

/**
 * POST /setup-business
 * Creates or updates the user and business based on Facebook Auth data.
 */
router.post('/', async (req, res) => {
  try {
    const {
      appId,
      user, // Comes from Facebook Auth
      accessToken, // Facebook token
      businessName,
      contactEmail,
      locations = [],
      insurancePolicies = [],
      objections = [],
      aiKnowledgeBase = '',
      pageId = null,
    } = req.body;

    const pageId = page_id;

    console.log('[DEBUG] Incoming Payload:', req.body);

    // Step 1: Input validation
    if (appId !== 'milaVerse') {
      return res.status(400).json({ error: 'Unknown application', appId });
    }

    if (!businessName || !user?.id || !contactEmail) {
      return res.status(400).json({
        error: 'Missing required fields',
        requiredFields: ['businessName', 'user.id', 'contactEmail'],
      });
    }

    // Step 2: Hypothetical function to fetch Instagram ID (stubbed for now)
    const igId = await fetchInstagramId(user.id, accessToken);

    // Step 3: Upsert user in Supabase
    console.log('[DEBUG] Checking for existing user...');
    const { data: existingUser, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('fb_id', user.id)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      console.error('[ERROR] Failed to fetch user:', userError.message);
      throw new Error('Failed to fetch user');
    }

    if (existingUser) {
      console.log('[DEBUG] Updating existing user...');
      const { error: updateError } = await supabase
        .from('users')
        .update({
          name: user.name,
          email: contactEmail,
          ig_id: igId,
        })
        .eq('id', existingUser.id);

      if (updateError) throw new Error('Failed to update user');
    } else {
      console.log('[DEBUG] Inserting new user...');
      const { error: insertError } = await supabase
        .from('users')
        .insert([{ fb_id: user.id, name: user.name, email: contactEmail, ig_id: igId }]);

      if (insertError) throw new Error('Failed to insert user');
    }

    // Step 4: Insert or Upsert business in Supabase
    console.log('[DEBUG] Inserting business into Supabase...');
    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .insert([
        {
          name: businessName,
          owner_id: user.id,
          contact_email: contactEmail,
          locations,
          insurance_policies: insurancePolicies,
          objections,
          ai_knowledge_base: aiKnowledgeBase,
          page_id: pageId,
        },
      ])
      .select();

    if (businessError) {
      console.error('[ERROR] Business Insert Failed:', businessError.message);
      throw new Error('Failed to create business');
    }

    console.log('[SUCCESS] Business Created:', businessData);

    // Step 5: Response
    res.status(200).json({
      message: 'Business setup successful',
      business: businessData,
    });
  } catch (error) {
    console.error('[ERROR] /setup-business:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Example function to fetch Instagram ID (stub)
async function fetchInstagramId(fbId, accessToken) {
  console.log('[DEBUG] Fetching Instagram ID for FB ID:', fbId);
  // Replace this with real logic to fetch the IG ID using Facebook Graph API
  return null;
}

export default router;
