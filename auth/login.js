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

// Helper Function: Fetch Facebook Pages
const fetchPages = async (accessToken) => {
  let pages = [];
  let nextUrl = `https://graph.facebook.com/me/accounts?access_token=${accessToken}`;

  while (nextUrl) {
    const response = await fetch(nextUrl);
    if (!response.ok) throw new Error('Failed to fetch pages');

    const data = await response.json();
    pages = pages.concat(data.data);
    nextUrl = data.paging?.next || null;
  }

  return pages;
};

// Helper Function: Fetch Instagram Business Account ID
const fetchInstagramId = async (accessToken) => {
  const response = await fetch(`https://graph.facebook.com/me?fields=instagram_business_account&access_token=${accessToken}`);
  if (!response.ok) return null;

  const data = await response.json();
  return data.instagram_business_account?.id || null;
};

/**
 * POST /auth/login
 * Handles user authentication, fetches Facebook user/pages data,
 * inserts or updates users, pages, and businesses into the database.
 */
router.post('/', loginLimiter, async (req, res) => {
  try {
    // 1. Validate Request
    const { error, value } = loginSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { accessToken } = value;

    // 2. Fetch Facebook User Data
    const fbResponse = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`);
    if (!fbResponse.ok) throw new Error('Invalid Facebook Access Token');

    const fbUser = await fbResponse.json();
    const { id: fb_id, name, email } = fbUser;

    console.log('[DEBUG] Facebook User:', fbUser);

    // 3. Fetch Instagram Business Account ID
    const ig_id = await fetchInstagramId(accessToken);
    console.log('[DEBUG] Instagram Business ID:', ig_id);

    // 4. Insert or Update User
    const { data: user, error: userError } = await supabase
      .from('users')
      .upsert([{ fb_id, name, email, ig_id }], { onConflict: 'fb_id' })
      .select('*')
      .single();

    if (userError) throw userError;
    console.log('[DEBUG] User Upserted:', user);

    // 5. Fetch and Insert/Update Pages
    const pagesData = await fetchPages(accessToken);
    if (!pagesData.length) throw new Error('No Facebook Pages Found');

    await Promise.all(
      pagesData.map(async (page) => {
        const { error: pageError } = await supabase
          .from('pages')
          .upsert(
            { page_id: page.id, name: page.name, access_token: page.access_token },
            { onConflict: 'page_id' }
          );
        if (pageError) throw pageError;
      })
    );

    console.log('[DEBUG] Pages Upserted');

    // 6. Fetch the Page ID (auto-incremented id) to Link Business
    const { data: page, error: pageError } = await supabase
      .from('pages')
      .select('id')
      .eq('page_id', pagesData[0].id)
      .single();

    if (pageError || !page) throw new Error('Failed to find page in database');
    console.log('[DEBUG] Page ID Found:', page);

    // 7. Insert or Update Business
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .upsert(
        [{ user_id: user.id, name: `${name}'s Business`, page_id: page.id }],
        { onConflict: 'user_id' }
      )
      .select('*')
      .single();

    if (businessError) throw businessError;
    console.log('[DEBUG] Business Upserted:', business);

    // 8. Set Cookies for Authentication
    res.cookie('authToken', accessToken, { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });
    res.cookie('userId', user.id.toString(), { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });
    res.cookie('businessId', business.id.toString(), { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });

    // 9. Success Response
    return res.status(200).json({
      message: 'Login successful',
      user,
      business,
    });
  } catch (err) {
    console.error('[ERROR]', err.message);
    return res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

export default router;
