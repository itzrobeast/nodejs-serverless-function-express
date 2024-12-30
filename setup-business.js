import express from 'express';
import supabase from './supabaseClient.js';
import fetch from 'node-fetch';

const router = express.Router();

// Helper: Subscribe a page to the webhook
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

// POST /setup-business
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
    } = req.body;

    if (appId !== 'milaVerse') {
      return res.status(400).json({ error: 'Invalid application' });
    }

    // Upsert User
    await supabase.from('users').upsert({ fb_id: user.id, name: user.name, email: contactEmail });

    // Fetch Pages
    const pagesResponse = await fetch(`https://graph.facebook.com/me/accounts?access_token=${accessToken}`);
    if (!pagesResponse.ok) throw new Error('Failed to fetch Facebook Pages');
    const pagesData = await pagesResponse.json();

    for (const page of pagesData.data) {
      const { id: pageId, access_token: pageAccessToken, name: pageName } = page;

      // Upsert Business
      const igId = await fetchInstagramId(pageId, pageAccessToken);
      await supabase.from('businesses').upsert({
        name: businessName,
        owner_id: user.id,
        contact_email: contactEmail,
        locations,
        insurance_policies: insurancePolicies,
        objections,
        ai_knowledge_base: aiKnowledgeBase,
        page_id: pageId,
        ig_id: igId,
      });

      // Subscribe Page to Webhook
      await subscribePageToWebhook(pageId, pageAccessToken);
    }

    res.status(200).json({ message: 'Business setup successful' });
  } catch (error) {
    console.error('[ERROR]', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
