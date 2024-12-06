import express from 'express';
import jwt from 'jsonwebtoken';
import supabase from './supabaseClient.js';
import fetch from 'node-fetch';

const router = express.Router();

// Function to generate JWT
const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    process.env.MILA_SECRET,
    { expiresIn: '1h' }
  );
};

// Placeholder for fetchInstagramId (ensure this is defined or imported)
const fetchInstagramId = async (fbId, accessToken) => {
  const url = `https://graph.facebook.com/v14.0/${fbId}/accounts?fields=instagram_business_account&access_token=${accessToken}`;
  try {
    const response = await fetch(url);
    const data = await response.json();

    if (response.ok && data?.data?.length > 0) {
      const account = data.data.find(acc => acc.instagram_business_account);
      return account?.instagram_business_account?.id || null;
    }

    console.warn('[WARN] No Instagram Business Account linked.');
    return null;
  } catch (error) {
    console.error('[ERROR] fetchInstagramId failed:', error.message);
    return null;
  }
};

// Placeholder for getPlatform (ensure this is defined or imported)
const getPlatform = (req) => {
  const userAgent = req.headers['user-agent'] || '';
  if (/mobile/i.test(userAgent)) return 'Mobile';
  if (/tablet/i.test(userAgent)) return 'Tablet';
  return 'Web';
};

// POST Handler for /setup-business
router.post('/', async (req, res) => {
  try {
    const {
      appId,
      user,
      accessToken,
      businessName,
      contactEmail,
      locations,
      insurancePolicies,
      objections,
      aiKnowledgeBase = '',
      pageId,
    } = req.body;

    console.log('[DEBUG] POST /setup-business payload:', req.body);

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

    // Fetch Instagram User ID
    const igId = await fetchInstagramId(user.id, accessToken);
    console.log('[DEBUG] Instagram ID fetched:', igId);

    // Step 1: Check or Insert User
    const { data: existingUser, error: userFetchError } = await supabase
      .from('users')
      .select('*')
      .eq('fb_id', user.id)
      .single();

    if (userFetchError && userFetchError.code !== 'PGRST116') {
      console.error('[ERROR] Failed to fetch user:', userFetchError.message);
      throw new Error('Database error while fetching user');
    }

    if (existingUser) {
      console.log('[INFO] Updating existing user...');
      const { error: updateError } = await supabase
        .from('users')
        .update({ name: user.name, email: user.email, ig_id: igId })
        .eq('id', existingUser.id);

      if (updateError) {
        console.error('[ERROR] User update failed:', updateError.message);
        throw new Error('Failed to update user');
      }
    } else {
      console.log('[INFO] Creating new user...');
      const { error: insertError } = await supabase
        .from('users')
        .insert([{ fb_id: user.id, ig_id: igId, name: user.name, email: user.email }]);

      if (insertError) {
        console.error('[ERROR] User insert failed:', insertError.message);
        throw new Error('Failed to insert user');
      }
    }

    // Step 2: Check or Insert Business
    const { data: existingBusiness, error: businessFetchError } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', user.id)
      .single();

    let businessData;
    if (existingBusiness) {
      console.log('[INFO] Updating existing business...');
      const updateFields = {
        name: businessName,
        contact_email: contactEmail,
        locations: locations || [],
        insurance_policies: insurancePolicies || {},
        objections: objections || {},
        ai_knowledge_base: aiKnowledgeBase,
        page_id: pageId,
        platform: getPlatform(req),
      };

      const { error: updateError } = await supabase
        .from('businesses')
        .update(updateFields)
        .eq('id', existingBusiness.id);

      if (updateError) {
        console.error('[ERROR] Business update failed:', updateError.message);
        throw new Error('Failed to update business');
      }

      businessData = { ...existingBusiness, ...updateFields };
    } else {
      console.log('[INFO] Creating new business...');
      const { data: newBusiness, error: insertError } = await supabase
        .from('businesses')
        .insert([{
          name: businessName,
          owner_id: user.id,
          page_id: pageId,
          access_token: accessToken,
          contact_email: contactEmail,
          locations: locations || [],
          insurance_policies: insurancePolicies || {},
          objections: objections || {},
          ai_knowledge_base: aiKnowledgeBase,
          platform: getPlatform(req),
        }])
        .single();

      if (insertError) {
        console.error('[ERROR] Business insert failed:', insertError.message);
        throw new Error('Failed to insert business');
      }

      businessData = newBusiness;
    }

    // Step 3: Generate JWT and Return Response
    const token = generateToken(user);

    return res.status(200).json({
      message: 'Business setup successful',
      business: businessData,
      token,
    });
  } catch (error) {
    console.error('[ERROR] /setup-business:', error.message);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message,
    });
  }
});

export default router;
