import express from 'express';
import supabase from './supabaseClient.js';
import fetch from 'node-fetch';

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

// Function to fetch Instagram User ID (ig_id) from Facebook Graph API
async function fetchInstagramId(fbId, accessToken) {
  const url = `https://graph.facebook.com/v14.0/${fbId}/accounts?fields=instagram_business_account&access_token=${accessToken}`;
  try {
    const response = await fetch(url);
    const data = await response.json();

    if (response.ok && data.data.length > 0) {
      const instagramAccount = data.data.find(acc => acc.instagram_business_account);
      if (instagramAccount && instagramAccount.instagram_business_account) {
        console.log('[INFO] Instagram ID found:', instagramAccount.instagram_business_account.id);
        return instagramAccount.instagram_business_account.id;
      }
    }

    console.warn('[WARN] No linked Instagram account found.');
    return null;
  } catch (error) {
    console.error('[ERROR] Failed to fetch Instagram ID:', error.message);
    return null;
  }
}

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

    console.log('[DEBUG] POST /setup-business hit:', req.body);

    // Determine platform dynamically
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

    // Fetch Instagram User ID (ig_id)
    const igId = await fetchInstagramId(user.id, accessToken);

    // Step 1: Check or Insert User
    let { data: existingUser, error: userFetchError } = await supabase
      .from('users')
      .select('*')
      .eq('fb_id', user.id)
      .single();

    if (userFetchError && userFetchError.code !== 'PGRST116') {
      console.error('[ERROR] Failed to fetch existing user:', userFetchError.message);
      throw new Error('Database error while fetching user');
    }

    if (existingUser) {
      console.log('[INFO] User already exists. Updating user details...');
      const { error: updateError } = await supabase
        .from('users')
        .update({
          name: user.name,
          email: user.email,
          ig_id: igId,
        })
        .eq('id', existingUser.id);

      if (updateError) {
        console.error('[ERROR] Failed to update user:', updateError.message);
        throw new Error('Failed to update user');
      }
    } else {
      console.log('[INFO] User does not exist. Creating new user...');
      const { error: insertError } = await supabase
        .from('users')
        .insert([
          {
            fb_id: user.id,
            ig_id: igId,
            name: user.name,
            email: user.email,
          },
        ]);

      if (insertError) {
        console.error('[ERROR] Failed to insert new user:', insertError.message);
        throw new Error('Failed to insert new user');
      }
    }

    // Step 2: Check or Insert Business
    const { data: existingBusiness, error: businessFetchError } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', user.id)
      .single();

    if (businessFetchError && businessFetchError.code !== 'PGRST116') {
      console.error('[ERROR] Failed to fetch existing business:', businessFetchError.message);
      throw new Error('Database error while fetching business');
    }

    if (existingBusiness) {
      console.log('[INFO] Business already exists. Updating business details...');
      const updateFields = {
        name: businessName || existingBusiness.name,
        contact_email: contactEmail || existingBusiness.contact_email,
        locations: locations !== undefined ? locations : existingBusiness.locations, // Preserve existing if not provided
        insurance_policies:
          insurancePolicies !== undefined ? insurancePolicies : existingBusiness.insurance_policies,
        objections: objections !== undefined ? objections : existingBusiness.objections,
        ai_knowledge_base: aiKnowledgeBase || existingBusiness.ai_knowledge_base,
        page_id: pageId || existingBusiness.page_id,
        platform,
      };

      const { error: updateError } = await supabase
        .from('businesses')
        .update(updateFields)
        .eq('id', existingBusiness.id);

      if (updateError) {
        console.error('[ERROR] Failed to update business:', updateError.message);
        throw new Error('Failed to update business');
      }

      return res.status(200).json({
        message: 'Business updated successfully',
        data: updateFields,
      });
    } else {
      console.log('[INFO] Business does not exist. Creating new business...');
      const { error: insertError } = await supabase
        .from('businesses')
        .insert([
          {
            name: businessName,
            owner_id: user.id,
            page_id: pageId || null,
            access_token: accessToken || null,
            contact_email: contactEmail,
            locations: locations || [], // Default only for new business
            insurance_policies: insurancePolicies || {}, // Default only for new business
            objections: objections || {}, // Default only for new business
            ai_knowledge_base: aiKnowledgeBase,
            platform,
          },
        ]);

      if (insertError) {
        console.error('[ERROR] Failed to insert new business:', insertError.message);
        throw new Error('Failed to insert new business');
      }

      return res.status(201).json({ message: 'Business setup successful' });
    }
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

