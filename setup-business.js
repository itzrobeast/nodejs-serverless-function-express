import express from 'express';
import supabase from './supabaseClient.js';
import fetch from 'node-fetch';

const router = express.Router();

/**
 * Helper: Subscribe a page to the webhook
 */
async function subscribePageToWebhook(pageId, pageAccessToken) {
  try {
    const response = await fetch(`https://graph.facebook.com/v15.0/${pageId}/subscribed_apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: pageAccessToken }),
    });

    const data = await response.json();
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
 * Helper: Fetch Instagram Business Account ID
 */
async function fetchInstagramId(pageId, pageAccessToken) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v15.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
    );
    const data = await response.json();
    if (response.ok && data.instagram_business_account) {
      console.log(`[INFO] Instagram Business Account ID for Page ${pageId}:`, data.instagram_business_account.id);
      return data.instagram_business_account.id;
    }
    console.warn(`[WARN] No Instagram Business Account linked to Page ID: ${pageId}`);
    return null;
  } catch (error) {
    console.error('[ERROR] Failed to fetch Instagram Business Account ID:', error.message);
    return null;
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
      user, // Facebook User Info
      accessToken, // Facebook User Access Token
      businessName,
      contactEmail,
      locations = [],
      insurancePolicies = [],
      objections = [],
      aiKnowledgeBase = '',
    } = req.body;

    console.log('[DEBUG] /setup-business route hit with payload:', req.body);

    // Step 1: Validate Application ID
    if (appId !== 'milaVerse') {
      return res.status(400).json({ error: 'Invalid application' });
    }

    // Step 2: Upsert User in Supabase
    const { error: userError } = await supabase
      .from('users')
      .upsert({ fb_id: user.id, name: user.name, email: contactEmail });

    if (userError) {
      throw new Error(`Failed to upsert user: ${userError.message}`);
    }

    console.log('[INFO] User upserted successfully');

    // Step 3: Fetch Facebook Pages
    const pagesResponse = await fetch(
      `https://graph.facebook.com/me/accounts?access_token=${accessToken}`
    );

    if (!pagesResponse.ok) {
      throw new Error('Failed to fetch Facebook Pages');
    }

    const pagesData = await pagesResponse.json();

    // Step 4: Process Each Page
    for (const page of pagesData.data) {
      const { id: pageId, access_token: pageAccessToken, name: pageName } = page;

      // Fetch Instagram Business Account ID
      const igId = await fetchInstagramId(pageId, pageAccessToken);

      // Upsert Business in Supabase
      const { error: businessError } = await supabase.from('businesses').upsert({
        name: businessName || `${pageName} Business`,
        owner_id: user.id,
        contact_email: contactEmail,
        locations,
        insurance_policies: insurancePolicies,
        objections,
        ai_knowledge_base: aiKnowledgeBase,
        page_id: pageId,
        ig_id: igId,
      });

      if (businessError) {
        throw new Error(`Failed to upsert business for Page ID ${pageId}: ${businessError.message}`);
      }

      console.log(`[INFO] Business upserted for Page ID ${pageId}`);

      // Subscribe Page to Webhook
      const subscriptionSuccess = await subscribePageToWebhook(pageId, pageAccessToken);

      if (!subscriptionSuccess) {
        console.warn(`[WARN] Failed to subscribe Page ID ${pageId} to webhook`);
      }
    }

    // Step 5: Send Success Response
    res.status(200).json({ message: 'Business setup successful' });
  } catch (error) {
    console.error('[ERROR] /setup-business:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
