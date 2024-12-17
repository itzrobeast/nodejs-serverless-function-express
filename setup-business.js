import express from 'express';
import jwt from 'jsonwebtoken';
import supabase from './supabaseClient.js';

const router = express.Router();

/**
 * POST /setup-business
 * Used to create a business and upsert user data into Supabase.
 */
router.post('/', async (req, res) => {
  try {
    const {
      appId,
      user,
      accessToken,
      businessName,
      contactEmail,
      locations = [],
      insurancePolicies = [],
      objections = [],
      aiKnowledgeBase = '',
      pageId = null,
    } = req.body;

    console.log('[DEBUG] Incoming Payload:', req.body);

    // Input validation
    if (!appId || appId !== 'milaVerse') {
      return res.status(400).json({ error: 'Unknown application', appId });
    }

    if (!businessName || !user?.id || !contactEmail) {
      return res.status(400).json({
        error: 'Missing required fields',
        requiredFields: ['businessName', 'user.id', 'contactEmail'],
      });
    }

    // Debugging: Ensure Service Role is active
    const { data: roleCheck, error: roleError } = await supabase.rpc('get_current_user_role');
    console.log('[DEBUG] Current Supabase Role:', roleCheck);
    if (roleError) {
      console.error('[ERROR] Failed Role Check:', roleError.message);
      throw new Error('Supabase role check failed');
    }

    // Hypothetical function to fetch Instagram ID
    const igId = await fetchInstagramId(user.id, accessToken);

    // Upsert user in Supabase
    console.log('[DEBUG] Checking for existing user...');
    const { data: existingUser, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('fb_id', user.id)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      console.error('[ERROR] Fetch User Error:', userError.message);
      throw new Error('Failed to fetch user');
    }

    if (existingUser) {
      console.log('[DEBUG] Updating existing user...');
      const { error: updateError } = await supabase
        .from('users')
        .update({ name: user.name, email: user.email, ig_id: igId })
        .eq('id', existingUser.id);
      if (updateError) throw new Error('Failed to update user');
    } else {
      console.log('[DEBUG] Inserting new user...');
      const { error: insertError } = await supabase
        .from('users')
        .insert([{ fb_id: user.id, ig_id: igId, name: user.name, email: user.email }]);
      if (insertError) throw new Error('Failed to insert user');
    }

    // Insert business into Supabase
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

    // Generate token
    const token = jwt.sign(
      { id: user.id, email: contactEmail },
      process.env.MILA_SECRET,
      { expiresIn: '1h' }
    );

    // Response
    res.status(200).json({
      message: 'Business setup successful',
      business: businessData,
      token,
    });
  } catch (error) {
    console.error('[ERROR] /setup-business:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Example stub for fetching IG ID
async function fetchInstagramId(fbId, accessToken) {
  console.log('[DEBUG] Fetching Instagram ID for user:', fbId);
  return null; // Replace this with real logic
}

export default router;
