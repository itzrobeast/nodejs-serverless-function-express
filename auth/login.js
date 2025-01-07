// File: auth/login.js

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
// POST /auth/login
// --------------------------------------------------
router.post('/', loginLimiter, async (req, res) => {
  try {
    // --------------------------------------------
    // Step 1: Validate input
    // --------------------------------------------
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    const { accessToken } = value;

    // --------------------------------------------
    // Step 2: Validate Facebook Token
    // --------------------------------------------
    const tokenDetails = await validateFacebookToken(accessToken);
    if (!tokenDetails.isValid) {
      throw new Error('Invalid or expired Facebook token. Please log in again.');
    }

    // --------------------------------------------
    // Step 3: Refresh Token if Necessary
    // --------------------------------------------
    const refreshedToken = await refreshUserAccessToken(tokenDetails.userId, accessToken);
    const finalAccessToken = refreshedToken || accessToken;
    console.log('[DEBUG] Final Access Token:', finalAccessToken);

    // --------------------------------------------
    // Step 4: Fetch Facebook User Data
    // --------------------------------------------
    const fbUserResponse = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${finalAccessToken}`
    );
    if (!fbUserResponse.ok) {
      throw new Error('Failed to fetch Facebook user data.');
    }
    const fbUser = await fbUserResponse.json();
    const { id: fb_id, name, email } = fbUser;
    console.log('[DEBUG] Facebook User Data:', fbUser);

    // --------------------------------------------
    // Step 5: Fetch Facebook Pages (taking the first)
    // --------------------------------------------
    const pagesResponse = await fetch(
      `https://graph.facebook.com/me/accounts?access_token=${finalAccessToken}`
    );
    if (!pagesResponse.ok) {
      throw new Error('Failed to fetch Facebook pages.');
    }
    const pagesData = await pagesResponse.json();

    const firstPage = pagesData.data?.[0];
    if (!firstPage) {
      throw new Error('No Facebook pages found for this user.');
    }
    const pageAccessToken = firstPage.access_token;
    console.log('[DEBUG] Using First Page:', firstPage);

    // --------------------------------------------
    // Step 6: Fetch Instagram Business ID (optional)
    // --------------------------------------------
    const fetchedIgId = await fetchInstagramIdFromFacebook(firstPage.id, pageAccessToken);
    if (!fetchedIgId) {
      console.warn('[WARN] Failed to fetch Instagram Business ID (ig_id). Proceeding without it.');
    } else {
      console.log(`[DEBUG] Fetched Instagram Business ID (ig_id): ${fetchedIgId}`);
    }

    // --------------------------------------------
    // Step 7: Upsert Business Owner
    // --------------------------------------------
    const { data: owner, error: ownerError } = await supabase
      .from('business_owners')
      .upsert(
        {
          fb_id,
          name,
          email,
          businessId,
          page_id: firstPage.id,
          ig_id: fetchedIgId || null,
          user_access_token: finalAccessToken,
        },
        { onConflict: 'fb_id' } // Update if fb_id already exists
      )
      .select()
      .single();

    if (ownerError) {
      throw new Error(`User upsert failed: ${ownerError.message}`);
    }
    console.log('[DEBUG] Business Owner Upserted:', owner);

    // --------------------------------------------
    // Step 8: Upsert Business
    // --------------------------------------------
    const businessPayload = {
      business_owner_id: owner.id,
      business_id: business.id
      name: `${name}'s Business`,
      page_id: firstPage.id,
      ig_id: fetchedIgId || null,
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

    // --------------------------------------------
    // Step 9: Upsert Page in the Pages Table
    // --------------------------------------------
    const { data: existingPage, error: pageFetchError } = await supabase
      .from('pages')
      .select('id')
      .eq('page_id', firstPage.id)
      .single();

    // If there's an error other than "Row not found" (code = 'PGRST116'), throw
    if (pageFetchError && pageFetchError.code !== 'PGRST116') {
      throw new Error(
        `Error checking existing page with page_id ${firstPage.id}: ${pageFetchError.message}`
      );
    }

    if (existingPage) {
      // Update existing page
      const { error: pageUpdateError } = await supabase
        .from('pages')
        .update({
          name: firstPage.name,
          category: firstPage.category || null, // if you want to store the category
          page_access_token: pageAccessToken,
          business_id: business.id,
        })
        .eq('id', existingPage.id);
      if (pageUpdateError) {
        throw new Error(
          `Page update failed for page_id ${firstPage.id}: ${pageUpdateError.message}`
        );
      }
      console.log(
        `[INFO] Page updated successfully for page_id ${firstPage.id}, linked to business_id ${business.id}`
      );
    } else {
      // Insert a new page
      const { data: newPage, error: pageInsertError } = await supabase
        .from('pages')
        .insert({
          page_id: firstPage.id,
          name: firstPage.name,
          category: firstPage.category || null,
          page_access_token: pageAccessToken,
          business_id: business.id,
        })
        .select()
        .single();

      if (pageInsertError) {
        throw new Error(
          `Page insert failed for page_id ${firstPage.id}: ${pageInsertError.message}`
        );
      }
      console.log(
        `[INFO] Page inserted successfully with page_id ${firstPage.id}, linked to business_id ${business.id}`
      );
    }

    // --------------------------------------------
    // Step 10: Set Secure Cookies
    // --------------------------------------------
    // Important: includes businessOwnerId, businessId, etc.
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
      maxAge: 3600000,
    });
    res.cookie('businessId', business.id.toString(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None',
      maxAge: 3600000,
    });
    res.cookie('pageAccessToken', pageAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None',
      maxAge: 3600000,
    });

    // --------------------------------------------
    // Step 11: Final Response
    // --------------------------------------------
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
