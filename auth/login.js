// login.js

import express from 'express';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import { fetchInstagramIdFromFacebook, validateFacebookToken } from '../helpers.js';
import { refreshUserAccessToken } from './refresh-token.js';

const router = express.Router();

// -------------------------------------
// Rate Limiter to prevent abuse
// -------------------------------------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  message: 'Too many login attempts. Please try again later.',
});

// -------------------------------------
// Input Validation Schema
// -------------------------------------
const loginSchema = Joi.object({
  accessToken: Joi.string().required(),
});

// -------------------------------------
// POST /auth/login
// -------------------------------------
router.post('/', loginLimiter, async (req, res) => {
  try {
    // -------------------------------------------------
    // Step 1: Validate input
    // -------------------------------------------------
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    const { accessToken } = value;

    // -------------------------------------------------
    // Step 2: Validate Facebook Token
    // -------------------------------------------------
    const tokenDetails = await validateFacebookToken(accessToken);
    if (!tokenDetails.isValid) {
      throw new Error('Invalid or expired Facebook token. Please log in again.');
    }

    // -------------------------------------------------
    // Step 3: Refresh Token if Necessary
    // -------------------------------------------------
    const refreshedToken = await refreshUserAccessToken(tokenDetails.userId, accessToken);
    const finalAccessToken = refreshedToken || accessToken;
    console.log('[DEBUG] Final Access Token:', finalAccessToken);

    // -------------------------------------------------
    // Step 4: Fetch Facebook User Data
    // -------------------------------------------------
    const fbUserResponse = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${finalAccessToken}`
    );
    if (!fbUserResponse.ok) {
      throw new Error('Failed to fetch Facebook user data.');
    }
    const fbUser = await fbUserResponse.json();
    const { id: fb_id, name, email } = fbUser;
    console.log('[DEBUG] Facebook User Data:', fbUser);

    // -------------------------------------------------
    // Step 5: Fetch Facebook Pages
    // -------------------------------------------------
    const pagesResponse = await fetch(
      `https://graph.facebook.com/me/accounts?access_token=${finalAccessToken}`
    );
    if (!pagesResponse.ok) {
      throw new Error('Failed to fetch Facebook pages.');
    }
    const pagesData = await pagesResponse.json();

    // For simplicity, we'll just take the first page:
    const firstPage = pagesData.data?.[0];
    if (!firstPage) {
      throw new Error('No Facebook pages found for this user.');
    }
    const pageAccessToken = firstPage.access_token;
    console.log('[DEBUG] Using First Page:', firstPage);

    // -------------------------------------------------
    // Step 6: (Optional) Fetch Instagram Business ID
    //         for the selected Page
    // -------------------------------------------------
    const fetchedIgId = await fetchInstagramIdFromFacebook(firstPage.id, pageAccessToken);
    if (!fetchedIgId) {
      console.warn(
        '[WARN] Failed to fetch Instagram Business ID (ig_id). Proceeding without it.'
      );
    } else {
      console.log(`[DEBUG] Fetched Instagram Business ID (ig_id): ${fetchedIgId}`);
    }

    // -------------------------------------------------
    // Step 7: Upsert Business Owner in Supabase
    // -------------------------------------------------
    // We store the FB user info in 'business_owners' table.
    // onConflict on 'fb_id' means if fb_id already exists, update instead of inserting a new row.
    const { data: owner, error: ownerError } = await supabase
      .from('business_owners')
      .upsert(
        {
          fb_id,
          name,
          email,
          page_id: firstPage.id,            // Store the main page_id
          ig_id: fetchedIgId || null,       // Instagram ID if available
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

    // -------------------------------------------------
    // Step 8: Upsert Business in Supabase
    // -------------------------------------------------
    // Ties the new or existing business owner (owner.id) to a business entry.
    // onConflict on 'business_owner_id' ensures one business per owner, if that’s your logic.
    const businessPayload = {
      business_owner_id: owner.id,          // Link to the owner’s ID
      name: `${name}'s Business`,           // Example naming convention
      page_id: firstPage.id,               // Track which FB page is “primary”
      ig_id: fetchedIgId || null,          // Instagram ID if available
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

    // -------------------------------------------------
    // Step 9: Upsert the Page in the Pages Table
    // -------------------------------------------------
    // Now that we have a 'business' record, we can link the page properly.
    // We'll store the FB page_id, page access token, name, category, etc.
    // Example columns: id (auto-increment), page_id (FB ID), name, category,
    // page_access_token, business_id (FK to 'businesses').
    // If the row with the same 'page_id' exists, update; otherwise insert.
    const { data: existingPage, error: pageFetchError } = await supabase
      .from('pages')
      .select('id')
      .eq('page_id', firstPage.id)
      .single();

    if (pageFetchError && pageFetchError.code !== 'PGRST116') {
      // Ignore "Row not found" errors (PGRST116),
      // but throw for other critical errors
      throw new Error(
        `Error checking existing page with page_id ${firstPage.id}: ${pageFetchError.message}`
      );
    }

    if (existingPage) {
      // Update the existing page record
      const { error: pageUpdateError } = await supabase
        .from('pages')
        .update({
          name: firstPage.name,
          category: firstPage.category || null, // if you'd like to store category
          page_access_token: pageAccessToken,
          business_id: business.id, // Link to the newly upserted business
        })
        .eq('id', existingPage.id);

      if (pageUpdateError) {
        throw new Error(
          `Page update failed for existing page_id ${firstPage.id}: ${pageUpdateError.message}`
        );
      }

      console.log(
        `[INFO] Page updated successfully for page_id ${firstPage.id}, linked to business_id ${business.id}`
      );
    } else {
      // Insert a brand new page record
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

    // -------------------------------------------------
    // Step 10: Set Secure Cookies (Auth Info)
    // -------------------------------------------------
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
    res.cookie('pageAccessToken', pageAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None',
      maxAge: 3600000, // 1 hour
    });

    // -------------------------------------------------
    // Step 11: Send Final Response
    // -------------------------------------------------
    return res.status(200).json({
      message: 'Login successful',
      businessOwnerId: owner.id,
      businessId: business.id,
      user: owner,
      business,
    });
  } catch (err) {
    console.error('[ERROR]', err.message);
    return res.status(500).json({
      error: 'Login failed',
      details: err.message,
    });
  }
});

export default router;
