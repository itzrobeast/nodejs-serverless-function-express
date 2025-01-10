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

// Helper: Upsert a single page and return its data
async function upsertPage(pageData, businessId = null) {
  const pageAccessToken = pageData.access_token;
  const fetchedIgId = await fetchInstagramIdFromFacebook(pageData.id, pageAccessToken);

  const { data, error } = await supabase
    .from('pages')
    .upsert(
      {
        page_id: pageData.id, // Facebook Page ID (text)
        name: pageData.name,
        category: pageData.category || null,
        page_access_token: pageAccessToken,
        ig_id: fetchedIgId || null, // Optional Instagram ID
        business_id: businessId, // Link to business_id if provided
      },
      { onConflict: 'page_id' }
    )
    .select('id, page_id, business_id, ig_id')
    .single();

  if (error) {
    throw new Error(`Page upsert failed: ${error.message}`);
  }

  return data;
}

// Main POST handler
router.post('/', loginLimiter, async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { accessToken } = value;

    // Validate Facebook Token
    const tokenDetails = await validateFacebookToken(accessToken);
    if (!tokenDetails.isValid) {
      throw new Error('Invalid or expired Facebook token. Please log in again.');
    }

    const refreshedToken = await refreshUserAccessToken(tokenDetails.userId, accessToken);
    const finalAccessToken = refreshedToken || accessToken;

    // Fetch Facebook User Data
    const fbUserRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${finalAccessToken}`
    );
    if (!fbUserRes.ok) {
      throw new Error('Failed to fetch Facebook user data.');
    }
    const fbUser = await fbUserRes.json();
    const { id: fb_id, name, email } = fbUser;

    // Fetch Facebook Pages
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

    // Upsert Pages and Associate with Business
    const upsertedPages = [];
    let primaryPageId; // To track the first page_id
    for (const page of pagesData.data) {
      const upsertedPage = await upsertPage(page); // Insert each page
      upsertedPages.push(upsertedPage);
      if (!primaryPageId) primaryPageId = upsertedPage.page_id; // Use the first page_id as primary
    }

    if (!primaryPageId) {
      throw new Error('No valid primary page ID found.');
    }

    
    // Fetch the ig_id for the primary page
// Fetch the correct ig_id from the pages table after upserting all pages
const correctPageData = upsertedPages.find(page => page.page_id === primaryPageId);

if (!correctPageData || !correctPageData.ig_id) {
  throw new Error('Failed to retrieve the correct ig_id for the primary page.');
}

const correctIgId = correctPageData.ig_id;


// Upsert Business Owner and include the primary page ID and ig_id
// Upsert Business Owner and include the correct ig_id from the pages table
const { data: owner, error: ownerError } = await supabase
  .from('business_owners')
  .upsert(
    {
      fb_id,
      name,
      email,
      user_access_token: finalAccessToken,
      page_id: primaryPageId, // Insert the primary page_id
      ig_id: correctIgId, // Use the correct ig_id
    },
    { onConflict: 'fb_id' }
  )
  .select()
  .single();

if (ownerError) {
  throw new Error(`User upsert failed: ${ownerError.message}`);
}


    // Upsert Business and include the correct ig_id
const { data: business, error: businessError } = await supabase
  .from('businesses')
  .upsert(
    {
      business_owner_id: owner.id,
      name: `${name}'s Business`,
      page_id: primaryPageId, // Insert the primary page_id
      ig_id: correctIgId, // Use the correct ig_id
    },
    { onConflict: 'business_owner_id' }
  )
  .select()
  .single();

if (businessError) {
  throw new Error(`Business upsert failed: ${businessError.message}`);
}

    // Link Business ID to Pages
    for (const page of upsertedPages) {
      const { error: pageUpdateError } = await supabase
        .from('pages')
        .update({ business_id: business.id })
        .eq('id', page.id);

      if (pageUpdateError) {
        console.error(`[WARN] Failed to update business_id in pages table for page_id: ${page.page_id}`, pageUpdateError.message);
      }
    }

    // Link Business ID to Business Owner
    const { error: ownerUpdateError } = await supabase
      .from('business_owners')
      .update({ business_id: business.id })
      .eq('id', owner.id);

    if (ownerUpdateError) {
      throw new Error(
        `Failed to update business_id in business_owners: ${ownerUpdateError.message}`
      );
    }

    // Set Secure Cookies
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
