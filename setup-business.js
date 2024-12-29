import express from 'express';
import supabase from './supabaseClient.js';
import fetch from 'node-fetch';

const router = express.Router();

/**
 * Helper function to subscribe a page to the webhook
 */
async function subscribePageToWebhook(pageId, pageAccessToken) {
  try {
    const response = await fetch(`https://graph.facebook.com/v15.0/${pageId}/subscribed_apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: pageAccessToken }),
    });

    const data = await response.json();
    console.log(`[DEBUG] Subscription Response for Page ID ${pageId}:`, data);

    if (data.error) {
      console.error(`[ERROR] Failed to subscribe page ${pageId}:`, data.error.message);
      return false;
    }

    console.log(`[INFO] Page ${pageId} successfully subscribed to webhook.`);
    return true;
  } catch (error) {
    console.error('[ERROR] Subscription to webhook failed:', error.message);
    return false;
  }
}


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
      page_id: pageId = null, // Destructure 'page_id' as 'pageId'
    } = req.body;

    console.log('[DEBUG] /setup-business route hit with payload:', req.body);

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
    const { data: existingUser, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('fb_id', user.id)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      throw new Error('Failed to fetch user');
    }

    if (existingUser) {
      await supabase
        .from('users')
        .update({ name: user.name, email: contactEmail, ig_id: igId })
        .eq('id', existingUser.id);
    } else {
      await supabase
        .from('users')
        .insert([{ fb_id: user.id, name: user.name, email: contactEmail, ig_id: igId }]);
    }

    // Step 4: Insert or Upsert business in Supabase
    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .insert([{
        name: businessName,
        owner_id: user.id,
        contact_email: contactEmail,
        locations,
        insurance_policies: insurancePolicies,
        objections,
        ai_knowledge_base: aiKnowledgeBase,
        page_id: pageId,
      }])
      .select();

    if (businessError) {
      throw new Error('Failed to create business');
    }

    console.log('[SUCCESS] Business Created:', businessData);

    // Step 5: Subscribe the page to the webhook
    if (pageId) {
      console.log(`[INFO] Subscribing page ${pageId} to webhook...`);
      
      const { data: pageData, error: pageError } = await supabase
        .from('pages')
        .select('page_access_token')
        .eq('page_id', pageId)
        .single();

      if (pageError || !pageData?.page_access_token) {
        console.error('[ERROR] Page access token not found for page:', pageId);
        return res.status(500).json({ error: 'Page access token not found' });
      }

      const subscriptionSuccess = await subscribePageToWebhook(pageId, pageData.page_access_token);
      if (!subscriptionSuccess) {
        console.error('[ERROR] Failed to subscribe page to webhook');
        return res.status(500).json({ error: 'Failed to subscribe page to webhook' });
      }
    }

    // Step 6: Response
    res.status(200).json({ message: 'Business setup successful', business: businessData });
  } catch (error) {
    console.error('[ERROR] /setup-business:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Example function to fetch Instagram ID (stub)
async function fetchInstagramId(fbId, accessToken) {
  console.log('[DEBUG] Fetching Instagram ID for FB ID:', fbId);
  return null; // Replace with real logic to fetch Instagram ID
}

export default router;
