import express from 'express';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate Limiter
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  message: 'Too many login attempts. Please try again later.',
});

// Input Validation Schema
const loginSchema = Joi.object({
  accessToken: Joi.string().required(),
});

// Helper: Subscribe a page to the webhook
async function subscribePageToWebhook(pageId, pageAccessToken) {
  try {
    const response = await fetch(`https://graph.facebook.com/v15.0/${pageId}/subscribed_apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: pageAccessToken,
        subscribed_fields: [
          'messages',
          'messaging_postbacks',
          'message_deliveries',
          'message_reads',
          'message_reactions',
        ],
      }),
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

// Helper: Fetch Instagram Business Account ID
async function fetchInstagramId(pageId, pageAccessToken) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
    );
    const data = await response.json();
    if (response.ok && data.instagram_business_account) {
      console.log('[DEBUG] Instagram Business Account ID:', data.instagram_business_account.id);
      return data.instagram_business_account.id;
    }
    console.warn('[WARN] No Instagram Business Account linked to Page ID:', pageId);
    return null;
  } catch (error) {
    console.error('[ERROR] Failed to fetch Instagram Business Account ID:', error.message);
    return null;
  }
}

// POST /auth/login
router.post('/', loginLimiter, async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { accessToken } = value;

    // Step 1: Fetch Facebook User Data
    const fbResponse = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`);
    if (!fbResponse.ok) throw new Error('Invalid Facebook Access Token');

    const fbUser = await fbResponse.json();
    const { id: fb_id, name, email } = fbUser;

    // Step 2: Fetch Facebook Pages
    const pagesResponse = await fetch(`https://graph.facebook.com/me/accounts?access_token=${accessToken}`);
    if (!pagesResponse.ok) throw new Error('Failed to fetch Facebook Pages');
    const pagesData = await pagesResponse.json();

    for (const page of pagesData.data) {
      const { id: pageId, access_token: pageAccessToken, name: pageName } = page;

      // Step 3: Upsert Page in Supabase
      await supabase
        .from('pages')
        .upsert({ page_id: pageId, name: pageName, access_token: pageAccessToken });

      // Step 4: Fetch Instagram Business Account ID
      const igBusinessAccountId = await fetchInstagramId(pageId, pageAccessToken);

      // Step 5: Upsert User
      await supabase
        .from('users')
        .upsert({ fb_id, name, email, ig_id: igBusinessAccountId }, { onConflict: 'fb_id' });

      // Step 6: Subscribe Page to Webhook
      const subscriptionSuccess = await subscribePageToWebhook(pageId, pageAccessToken);
      if (!subscriptionSuccess) {
        console.error(`[WARN] Failed to subscribe page ${pageId} to webhook.`);
      }
    }

    res.cookie('authToken', accessToken, { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });
    return res.status(200).json({ message: 'Login successful' });
  } catch (err) {
    console.error('[ERROR]', err.message);
    return res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

export default router;
