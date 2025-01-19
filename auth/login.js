// File: auth/login.js

import express from 'express';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import { validateFacebookToken, fetchInstagramIdFromFacebook } from '../helpers.js';
import { refreshUserAccessToken } from './refresh-token.js';

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

/**
 * Helper: Upsert a single page and return its data
 * @param {Object} pageData - The page data from Facebook
 * @param {number|null} businessId - The business ID to link, if any
 * @returns {Promise<Object>} - The upserted page object with additional info
 */
async function upsertPage(pageData, businessId = null) {
  const pageAccessToken = pageData.access_token;
  const fetchedIgId = await fetchInstagramIdFromFacebook(pageData.id, pageAccessToken);

  const { data, error } = await supabase
    .from('pages')
    .upsert(
      {
        page_id: pageData.id, // Facebook Page ID (string)
        name: pageData.name,
        category: pageData.category || null,
        page_access_token: pageAccessToken,
        ig_id: fetchedIgId || null, // Optional Instagram ID
        business_id: businessId,     // Link to business_id if provided
      },
      { onConflict: 'page_id' }
    )
    .select('id, page_id, business_id, ig_id')
    .single();

  if (error) {
    throw new Error(`Page upsert failed: ${error.message}`);
  }

  return { ...data, fetchedIgId };
}

// Main POST handler
router.post('/', loginLimiter, async (req, res) => {
  try {
    // Validate the incoming request body
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { accessToken } = value;

    // 1. Validate Facebook Token
    const tokenDetails = await validateFacebookToken(accessToken);
    if (!tokenDetails.isValid) {
      throw new Error('Invalid or expired Facebook token. Please log in again.');
    }

    // 2. Refresh the User Access Token (long-lived token logic)
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

    // 4. Fetch Facebook Pages for this user
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

    // 5. Upsert Pages (so we have them in our DB), track the first page as primary
    const upsertedPages = [];
    let primaryPageId;
    let primaryIgId = null;

    for (const page of pagesData.data) {
      const upsertedPage = await upsertPage(page); // Insert/update each page
      upsertedPages.push(upsertedPage);

      // The first page we encounter becomes the "primary" for the user
      if (!primaryPageId) {
        primaryPageId = upsertedPage.page_id;
        primaryIgId = upsertedPage.fetchedIgId || null;
      }
    }

    if (!primaryPageId) {
      throw new Error('No valid primary page ID found.');
    }

    // 6. Upsert the Business Owner with the correct primary page_id & ig_id
    const { data: owner, error: ownerError } = await supabase
      .from('business_owners')
      .upsert(
        {
          fb_id,
          name,
          email,
          user_access_token: finalAccessToken,
          page_id: primaryPageId,  // Link to primary page ID
          ig_id: primaryIgId,      // Link to the primary Instagram ID
        },
        { onConflict: 'fb_id' }
      )
      .select()
      .single();

    if (ownerError) {
      throw new Error(`User upsert failed: ${ownerError.message}`);
    }

    // 7. Upsert the Business with that same primary page_id & ig_id
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .upsert(
        {
          business_owner_id: owner.id,
          name: `${name}'s Business`,
          page_id: primaryPageId, // For convenience
          ig_id: primaryIgId,     // For convenience
        },
        { onConflict: 'business_owner_id' }
      )
      .select()
      .single();

    if (businessError) {
      throw new Error(`Business upsert failed: ${businessError.message}`);
    }

    // 8. Link the Business ID to all pages we just upserted
    for (const page of upsertedPages) {
      const { error: pageUpdateError } = await supabase
        .from('pages')
        .update({ business_id: business.id })
        .eq('id', page.id);

      if (pageUpdateError) {
        console.error(
          `[WARN] Failed to update business_id in pages table for page_id: ${page.page_id}`,
          pageUpdateError.message
        );
      }
    }

    // 9. Link the Business ID to the Business Owner
    const { error: ownerUpdateError } = await supabase
      .from('business_owners')
      .update({ business_id: business.id })
      .eq('id', owner.id);

    if (ownerUpdateError) {
      throw new Error(
        `Failed to update business_id in business_owners: ${ownerUpdateError.message}`
      );
    }

    // 10. Set Secure Cookies for session / auth tracking
    res.cookie('authToken', finalAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None',
      maxAge: 3600000, // 1 hour
    });
    res.cookie('businessOwnerId', owner.id.toString(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None',
      maxAge: 3600000, // 1 hour
    });
    res.cookie('businessId', business.id.toString(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None',
      maxAge: 3600000, // 1 hour
    });

    // ✅ Return success response
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
