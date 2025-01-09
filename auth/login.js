import express from 'express';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import { validateFacebookToken, fetchInstagramIdFromFacebook } from '../helpers.js';
import { refreshUserAccessToken } from './refresh-token.js';

const router = express.Router();

// --------------------------------------------------
// Rate Limiter to prevent abuse
// --------------------------------------------------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  message: 'Too many login attempts. Please try again later.',
});

// --------------------------------------------------
// Input Validation Schema
// --------------------------------------------------
const loginSchema = Joi.object({
  accessToken: Joi.string().required(),
});

// --------------------------------------------------
// Helper: Upsert All Pages
// --------------------------------------------------
async function upsertAllPages(pagesData = []) {
  const upsertedPages = [];

  for (const page of pagesData) {
    const pageAccessToken = page.access_token;
    const fetchedIgId = await fetchInstagramIdFromFacebook(page.id, pageAccessToken);

    const { data: pageRecord, error: pageError } = await supabase
      .from('pages')
      .upsert(
        {
          page_id: page.id,
          name: page.name,
          category: page.category || null,
          page_access_token: pageAccessToken,
          ig_id: fetchedIgId || null,
        },
        { onConflict: 'page_id' }
      )
      .select('id, page_id, ig_id')
      .single();

    if (pageError) {
      throw new Error(`Page upsert failed: ${pageError.message}`);
    }

    upsertedPages.push({
      ...page,
      id: pageRecord.id,
      ig_id: pageRecord.ig_id,
    });
  }

  return upsertedPages;
}

// --------------------------------------------------
// POST /auth/login
// --------------------------------------------------
router.post('/', loginLimiter, async (req, res) => {
  try {
    // 1. Validate input
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    const { accessToken } = value;

    // 2. Validate & Refresh Token
    const tokenDetails = await validateFacebookToken(accessToken);
    if (!tokenDetails.isValid) {
      throw new Error('Invalid or expired Facebook token. Please log in again.');
    }
    const refreshedToken = await refreshUserAccessToken(tokenDetails.userId, accessToken);
    const finalAccessToken = refreshedToken || accessToken;

    // 3. Fetch Facebook User Data
    const fbUserRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${finalAccessToken}`
    );
    if (!fbUserRes.ok) {
      throw new Error('Failed to fetch Facebook user data.');
    }
    const fbUser = await fbUserRes.json();
    const { id: fb_id, name, email } = fbUser;

    // 4. Fetch Facebook Pages
    const pagesRes = await fetch(
      `https://graph.facebook.com/me/accounts?access_token=${finalAccessToken}`
    );
    if (!pagesRes.ok) {
      throw new Error('Failed to fetch Facebook pages.');
    }
    const pagesData = await pagesRes.json();
    if (!pagesData?.data || pagesData.data.length === 0) {
      throw new Error('No Facebook pages found for this user.');
    }

    // 5. Upsert ALL pages first (so we have valid page IDs in DB)
    const upsertedPages = await upsertAllPages(pagesData.data);
    const primaryPage = upsertedPages[0];
    if (!primaryPage?.id) {
      throw new Error('No valid primary page ID found.');
    }

    // 6. Upsert Business Owner (linked to the primary page's ID)
    const { data: owner, error: ownerError } = await supabase
      .from('business_owners')
      .upsert(
        {
          fb_id,
          name,
          email,
          page_id: primaryPage.id,
          ig_id: primaryPage.ig_id || null,
          user_access_token: finalAccessToken,
        },
        { onConflict: 'fb_id' }
      )
      .select()
      .single();

    if (ownerError) {
      throw new Error(`User upsert failed: ${ownerError.message}`);
    }

    // 7. Upsert Business (linked to business_owners.id)
    const businessPayload = {
      business_owner_id: owner.id,
      name: `${name}'s Business`,
      page_id: primaryPage.id,
      ig_id: primaryPage.ig_id || null,
    };

    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .upsert(businessPayload, { onConflict: 'business_owner_id' })
      .select()
      .single();

    if (businessError) {
      throw new Error(`Business upsert failed: ${businessError.message}`);
    }

    // 8. Link the Business ID in business_owners
    const { error: ownerUpdateError } = await supabase
      .from('business_owners')
      .update({ business_id: business.id })
      .eq('id', owner.id);

    if (ownerUpdateError) {
      throw new Error(`Failed to update business_id in business_owners: ${ownerUpdateError.message}`);
    }

    // 9. Set Secure Cookies
    res.cookie('authToken', finalAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None',
      maxAge: 3600000,
    });
    res.cookie('businessOwnerId', owner.id.toString(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None',
      maxAge: 3600000,
    });
    res.cookie('businessId', business.id.toString(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None',
      maxAge: 3600000,
    });

    // 10. Final success response
    return res.status(200).json({
      message: 'Login successful',
      businessOwnerId: owner.id,
      businessId: business.id,
      user: owner,
      business,
    });
  } catch (err) {
    console.error('[ERROR]', err.message);
    return res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

export default router;
