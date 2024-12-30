import express from 'express';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate Limiter to prevent abuse
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  message: 'Too many login attempts. Please try again later.',
});

// Input Validation Schema
const loginSchema = Joi.object({
  accessToken: Joi.string().required(),
});

// Helper: Fetch Instagram Business ID
async function fetchInstagramId(pageId, pageAccessToken) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
    );
    const data = await response.json();
    if (!response.ok || !data.instagram_business_account) {
      console.warn('[WARN] No Instagram Business Account linked to Page ID:', pageId);
      return null;
    }
    console.log('[DEBUG] Instagram Business Account ID:', data.instagram_business_account.id);
    return data.instagram_business_account.id;
  } catch (err) {
    console.error('[ERROR] Failed to fetch Instagram Business Account ID:', err.message);
    return null;
  }
}

// Helper: Fetch Facebook Pages
async function fetchPages(accessToken) {
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
}

// POST /auth/login
router.post('/', loginLimiter, async (req, res) => {
  try {
    // Validate input
    const { error, value } = loginSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { accessToken } = value;

    // Step 1: Fetch Facebook User Data
    const fbResponse = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`);
    if (!fbResponse.ok) throw new Error('Invalid Facebook Access Token');
    const fbUser = await fbResponse.json();
    const { id: fb_id, name, email } = fbUser;

    // Step 2: Fetch Facebook Pages
    const pagesData = await fetchPages(accessToken);
    if (!pagesData.length) throw new Error('No Facebook Pages Found');

    const firstPage = pagesData[0];
    console.log('[DEBUG] Using page:', firstPage.name);

    // Step 3: Fetch Instagram Business ID for the Page
    const igId = await fetchInstagramId(firstPage.id, firstPage.access_token);
    if (!igId) {
      console.warn('[WARN] Instagram Business ID not found. Continuing without Instagram data.');
    }

    // Step 4: Upsert User
    const { data: user, error: userError } = await supabase
      .from('users')
      .upsert(
        {
          fb_id,
          name,
          email,
          ig_id: igId || null, // Accept null if IG ID is not found
        },
        { onConflict: ['fb_id'] }
      )
      .select()
      .single();

    if (userError) {
      console.error('[ERROR] User upsert failed:', userError.message);
      throw new Error(`User upsert failed: ${userError.message}`);
    }

    console.log('[DEBUG] User Upserted:', user);

    // Step 5: Upsert Facebook Pages
    for (const page of pagesData) {
      const { id: pageId, name: pageName, access_token: pageAccessToken } = page;

      if (!pageId) {
        console.warn('[WARN] Skipping invalid page with missing page_id.');
        continue;
      }

      const { error: pageError } = await supabase
        .from('pages')
        .upsert(
          {
            page_id: pageId,
            name: pageName,
            access_token: pageAccessToken,
          },
          { onConflict: ['page_id'] }
        );

      if (pageError) throw new Error(`Page upsert failed: ${pageError.message}`);
    }

    console.log('[DEBUG] Pages Upserted Successfully');

    // Step 6: Link Business to Facebook Page
    const businessData = {
      user_id: user.id,
      name: `${name}'s Business`,
      page_id: firstPage.id,
      ig_id: igId || null,
    };

    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .upsert(businessData, { onConflict: ['user_id'] })
      .select()
      .single();

    if (businessError) {
      console.error('[ERROR] Business upsert failed:', businessError.message);
      throw new Error(`Business upsert failed: ${businessError.message}`);
    }

    console.log('[DEBUG] Business Upserted:', business);

    // Step 7: Set Secure Cookies
    res.cookie('authToken', accessToken, { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });
    res.cookie('userId', user.id.toString(), { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });
    res.cookie('businessId', business.id.toString(), { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });

    // Step 8: Send Success Response
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
