import express from 'express';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate Limiter to prevent abuse
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many login attempts. Please try again later.',
});

// Input Validation Schema
const loginSchema = Joi.object({
  accessToken: Joi.string().required(),
});

// Helper: Fetch Instagram Business ID
const fetchInstagramId = async (accessToken) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/me?fields=instagram_business_account&access_token=${accessToken}`
    );

    if (!response.ok) {
      console.warn('[WARN] Failed to fetch Instagram Business ID:', response.statusText);
      return null;
    }

    const data = await response.json();
    return data.instagram_business_account?.id || null;
  } catch (err) {
    console.error('[ERROR] Failed to fetch Instagram Business ID:', err.message);
    return null;
  }
};

// Helper: Validate Instagram Business Account
const validateInstagramAccount = async (igId, accessToken) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${igId}?fields=id,username&access_token=${accessToken}`
    );

    if (!response.ok) {
      console.warn('[WARN] Failed to validate Instagram Business Account:', response.statusText);
      return null;
    }

    const data = await response.json();
    return data; // Contains `id` and `username`
  } catch (err) {
    console.error('[ERROR] Failed to validate Instagram Business Account:', err.message);
    return null;
  }
};

// Helper: Fetch Facebook Pages
const fetchPages = async (accessToken) => {
  let pages = [];
  let nextUrl = `https://graph.facebook.com/me/accounts?access_token=${accessToken}`;

  while (nextUrl) {
    const response = await fetch(nextUrl);
    if (!response.ok) throw new Error('Failed to fetch Facebook pages.');

    const data = await response.json();
    pages = pages.concat(data.data || []);
    nextUrl = data.paging?.next || null;
  }

  return pages;
};

// POST /auth/login
router.post('/', loginLimiter, async (req, res) => {
  try {
    // 1. Validate Input
    const { error, value } = loginSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { accessToken } = value;

    // 2. Fetch Facebook User Data
    const fbResponse = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`);
    if (!fbResponse.ok) throw new Error('Invalid Facebook Access Token');

    const fbUser = await fbResponse.json();
    const { id: fb_id, name, email } = fbUser;
    console.log('[DEBUG] Facebook User Data:', fbUser);

    // 3. Fetch Instagram Business ID
    const igId = await fetchInstagramId(accessToken);
    let instagramAccount = null;

    if (igId) {
      instagramAccount = await validateInstagramAccount(igId, accessToken);

      if (!instagramAccount) {
        console.warn('[WARN] Instagram Business Account exists but is invalid or inaccessible.');
      }
    }

    console.log('[DEBUG] Instagram Account Details:', instagramAccount);

    // 4. Upsert User
    const { data: user, error: userError } = await supabase
      .from('users')
      .upsert([{ fb_id, name, email, ig_id: igId, ig_username: instagramAccount?.username }], { onConflict: 'fb_id' })
      .select('*')
      .single();

    if (userError) throw new Error(`User upsert failed: ${userError.message}`);
    console.log('[DEBUG] User Upserted:', user);

    // 5. Fetch and Upsert Facebook Pages
    const pagesData = await fetchPages(accessToken);
    if (!pagesData.length) throw new Error('No Facebook Pages Found');

    for (const page of pagesData) {
      if (!page.id) {
        console.warn('[WARN] Skipping invalid page with missing page_id.');
        continue;
      }

      const { error: pageError } = await supabase
        .from('pages')
        .upsert(
          { page_id: page.id, name: page.name, access_token: page.access_token },
          { onConflict: 'page_id' }
        );

      if (pageError) throw new Error(`Page upsert failed: ${pageError.message}`);
    }

    console.log('[DEBUG] Pages Upserted Successfully');

    // 6. Link Business to Facebook Page
    const firstPage = pagesData[0];
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .upsert(
        [{ user_id: user.id, name: `${name}'s Business`, page_id: firstPage.id }],
        { onConflict: 'user_id' }
      )
      .select('*')
      .single();

    if (businessError) throw new Error(`Business upsert failed: ${businessError.message}`);
    console.log('[DEBUG] Business Upserted:', business);

    // 7. Set Secure Cookies
    res.cookie('authToken', accessToken, { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });
    res.cookie('userId', user.id.toString(), { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });
    res.cookie('businessId', business.id.toString(), { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });

    // 8. Send Success Response
    return res.status(200).json({
      message: 'Login successful',
      userId: user.id,
      businessId: business.id,
      user,
      business,
    });
  } catch (err) {
    console.error('[ERROR]', err.message);
    return res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

export default router;
