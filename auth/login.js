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

// POST /auth/login
router.post('/', loginLimiter, async (req, res) => {
  try {
    // Validate input
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
    const fbUserResponse = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${finalAccessToken}`
    );
    if (!fbUserResponse.ok) {
      throw new Error('Failed to fetch Facebook user data.');
    }
    const fbUser = await fbUserResponse.json();
    const { id: fb_id, name, email } = fbUser;

    // Fetch Facebook Pages
    const pagesResponse = await fetch(
      `https://graph.facebook.com/me/accounts?access_token=${finalAccessToken}`
    );
    if (!pagesResponse.ok) {
      throw new Error('Failed to fetch Facebook pages.');
    }
    const pagesData = await pagesResponse.json();

    if (!pagesData.data || pagesData.data.length === 0) {
      throw new Error('No Facebook pages found for this user.');
    }

   // Upsert Pages
const upsertedPages = [];
for (const page of pagesData.data) {
  const pageAccessToken = page.access_token;

  // Fetch Instagram Business ID (optional)
  const fetchedIgId = await fetchInstagramIdFromFacebook(page.id, pageAccessToken);
  console.log('[DEBUG] Fetched IG ID:', fetchedIgId, 'for Page ID:', page.id);

  // Upsert Page in Pages Table
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
    .select('id') // Fetch the ID for reference
    .single();

  if (pageError) {
    throw new Error(`Page upsert failed: ${pageError.message}`);
  }

  upsertedPages.push({ ...page, id: pageRecord.id });
}
console.log('[DEBUG] Upserted Pages:', upsertedPages);

// Use the first page for owner and business data
const firstPage = upsertedPages[0];

// Upsert Business Owner
const { data: owner, error: ownerError } = await supabase
  .from('business_owners')
  .upsert(
    {
      fb_id,
      name,
      email,
      page_id: firstPage.id, // Use the fetched ID from pages
      ig_id: firstPage.ig_id || null,
      user_access_token: finalAccessToken,
    },
    { onConflict: 'fb_id' }
  )
  .select()
  .single();

if (ownerError) {
  throw new Error(`User upsert failed: ${ownerError.message}`);
}
console.log('[DEBUG] Business Owner Upserted:', owner);

// Construct and Upsert Business
const businessPayload = {
  business_owner_id: owner.id,
  name: `${name}'s Business`,
  page_id: firstPage.id,
  ig_id: firstPage.ig_id || null,
};

const { data: business, error: businessError } = await supabase
  .from('businesses')
  .upsert(businessPayload, { onConflict: 'business_owner_id' })
  .select()
  .single();

if (businessError) {
  throw new Error(`Business upsert failed: ${businessError.message}`);
}
console.log('[DEBUG] Business Upserted:', business);

    

    // Handle Instagram Cleanup and Logic
    if (business.ig_id) {
      console.log('[DEBUG] Business has an Instagram ID. Handling Instagram-specific logic...');
      const { error: cleanUsersError } = await supabase
        .from('instagram_users')
        .delete()
        .eq('ig_id', business.ig_id);

      if (cleanUsersError) {
        console.warn('[WARN] Failed to clean Instagram users:', cleanUsersError.message);
      }

      const { error: cleanConversationsError } = await supabase
        .from('instagram_conversations')
        .delete()
        .eq('ig_id', business.ig_id);

      if (cleanConversationsError) {
        console.warn('[WARN] Failed to clean Instagram conversations:', cleanConversationsError.message);
      }
    } else {
      console.log('[DEBUG] Business does not have an Instagram ID. Skipping Instagram-specific logic.');
    }

    // Link Business ID to Business Owner
    await supabase.from('business_owners').update({ business_id: business.id }).eq('id', owner.id);

    console.log('[DEBUG] Linked Business ID to Business Owner:', business.id);

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




