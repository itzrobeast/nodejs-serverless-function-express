import express from 'express';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate Limiter
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
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

// POST /auth/login
router.post('/', loginLimiter, async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { accessToken } = value;

    // Fetch Facebook User Data
    const fbResponse = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`);
    if (!fbResponse.ok) throw new Error('Invalid Facebook Access Token');

    const fbUser = await fbResponse.json();
    const { id: fb_id, name, email } = fbUser;
    console.log('[DEBUG] Facebook User Data:', fbUser);

    // Fetch Facebook Pages
    const pagesResponse = await fetch(`https://graph.facebook.com/me/accounts?access_token=${accessToken}`);
    if (!pagesResponse.ok) throw new Error('Failed to fetch Facebook Pages');
    const pagesData = await pagesResponse.json();

    // Process Pages
    for (const page of pagesData.data) {
      const { id: pageId, access_token: pageAccessToken, name: pageName } = page;

      // Store page in Supabase
      await supabase
        .from('pages')
        .upsert({ page_id: pageId, name: pageName, access_token: pageAccessToken });

      // Subscribe the page to the webhook
      const subscriptionSuccess = await subscribePageToWebhook(pageId, pageAccessToken);
      if (!subscriptionSuccess) {
        console.error(`[WARN] Failed to subscribe page ${pageId} to webhook`);
      }
    }

    // Upsert User
    const { data: user, error: userError } = await supabase
      .from('users')
      .upsert(
        [{ fb_id, name, email }],
        { onConflict: 'fb_id' }
      )
      .select('*')
      .single();

    if (userError) {
      throw new Error(`User upsert failed: ${userError.message}`);
    }

    console.log('[DEBUG] User Upserted:', user);

    // Upsert Business
    const businessData = { user_id: user.id, name: `${name}'s Business` };
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .upsert(businessData, { onConflict: 'user_id' })
      .select('*')
      .single();

    if (businessError) {
      throw new Error(`Business upsert failed: ${businessError.message}`);
    }

    console.log('[DEBUG] Business Upserted:', business);

    // Handle Instagram Conversations
    if (user.ig_id) {
      try {
        await supabase
          .from('instagram_conversations')
          .upsert({
            fb_id: user.fb_id,
            ig_id: user.ig_id,
            page_id: user.page_id || null,
          });
        console.log('[DEBUG] Instagram conversations upserted successfully.');
      } catch (error) {
        console.error('[ERROR] Failed to upsert Instagram conversations:', error.message);
      }
    }

    // Set Cookies
    res.cookie('authToken', accessToken, { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });
    res.cookie('userId', user.id.toString(), { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });
    res.cookie('businessId', business.id.toString(), { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });

    // Response
    return res.status(200).json({ message: 'Login successful', userId: user.id, businessId: business.id });
  } catch (err) {
    console.error('[ERROR]', err.message);
    return res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

export default router;
