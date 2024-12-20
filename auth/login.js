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
const fetchInstagramIdFromPage = async (pageId, pageAccessToken) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
    );

    const data = await response.json();

    if (!response.ok || !data.instagram_business_account) {
      console.warn('[WARN] No Instagram Business Account linked to the page.');
      return null;
    }

    console.log('[DEBUG] Instagram Business Account ID:', data.instagram_business_account.id);
    return data.instagram_business_account.id;
  } catch (err) {
    console.error('[ERROR] Failed to fetch Instagram Business Account:', err.message);
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

    // 3. Fetch Facebook Pages
    const pagesData = await fetchPages(accessToken);
    if (!pagesData.length) throw new Error('No Facebook Pages Found');

    const firstPage = pagesData[0]; // Use the first page
    console.log('[DEBUG] Using page:', firstPage.name);

    // 4. Fetch Instagram Business ID for the Page
    const igId = await fetchInstagramIdFromPage(firstPage.id, firstPage.access_token);
    if (!igId) {
      console.warn('[WARN] Instagram Business ID not found. Continuing without Instagram data.');
    }

    // 5. Upsert User
    const { data: user, error: userError } = await supabase
      .from('users')
      .upsert(
        [
          {
            fb_id,
            name,
            email,
            ig_id: igId || null, // Accept null if IG ID is not found
          },
        ],
        { onConflict: 'fb_id' }
      )
      .select('*')
      .single();

if (userError) {
  console.error('[ERROR] User upsert failed:', userError.message);
  throw new Error(`User upsert failed: ${userError.message}`);
}

console.log('[DEBUG] User Upserted:', user);

    // 6. Upsert Facebook Pages
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

    // 7. Link Business to Facebook Page
    // 7. Link Business to Facebook Page
const businessData = {
  user_id: user.id,
  name: `${name}'s Business`,
  page_id: parseInt(firstPage.id.replace(/\D/g, ''), 10), // Extract numeric part of page_id
};

if (igId) {
  businessData.ig_id = parseInt(igId.replace(/\D/g, ''), 10); null, // Extract numeric part of ig_id
}

    
console.log('[DEBUG] Prepared businessData:', businessData);
const { data: business, error: businessError } = await supabase
  .from('businesses')
  .upsert(businessData, { onConflict: 'user_id' })
  .select('*')
  .single();

if (businessError) {
  console.error('[ERROR] Business upsert failed:', businessError.message);
  throw new Error(`Business upsert failed: ${businessError.message}`);
}
console.log('[DEBUG] Business Upserted:', business);


    // 8. Insert Page Access Tokens into `page_access_tokens`
    for (const page of pagesData) {
      if (!page.id || !page.access_token) {
        console.warn('[WARN] Skipping page with missing ID or Access Token.');
        continue;
      }

      const { error: accessTokenError } = await supabase
        .from('page_access_tokens')
        .upsert(
          {
            user_id: user.id,
            business_id: business.id,
            page_id: page.id,
            page_access_token: page.access_token,
          },
          { onConflict: 'page_id' }
        );

      if (accessTokenError) {
        console.error('[ERROR] Failed to upsert page access token:', accessTokenError.message);
        throw new Error(`Failed to insert page access token for page: ${page.id}`);
      }
    }

    console.log('[DEBUG] Page Access Tokens Upserted Successfully');

    // 9. Conditionally Handle Instagram Conversations Only If ig_id Exists
    if (user.ig_id) {
  try {
    await supabase
      .from('instagram_conversations')
      .upsert({
        fb_id: user.fb_id,
        ig_id: user.ig_id,
        page_id: user.page_id || null, // Use page_id if available
      });
    console.log('[DEBUG] Instagram conversations upserted successfully.');
  } catch (error) {
    console.error('Error upserting Instagram conversations:', error.message);
  }
} else {
  console.warn('No Instagram data found. Skipping Instagram conversations upsert.');
}
    // 10. Set Secure Cookies
    res.cookie('authToken', accessToken, { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });
    res.cookie('userId', user.id.toString(), { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });
    res.cookie('businessId', business.id.toString(), { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });

    // 11. Send Success Response
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
