import express from 'express';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import { fetchInstagramIdFromFacebook, validateFacebookToken } from '../helpers.js';
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
    // Step 1: Validate input
    const { error, value } = loginSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { accessToken } = value;

    // Step 2: Validate Facebook Token
    const tokenDetails = await validateFacebookToken(accessToken);
    if (!tokenDetails.isValid) {
      throw new Error('Invalid or expired Facebook token. Please log in again.');
    }

    // Step 3: Refresh Token if Necessary
    const refreshedToken = await refreshUserAccessToken(tokenDetails.userId, accessToken);
    const finalAccessToken = refreshedToken || accessToken;
    console.log('[DEBUG] Final Access Token:', finalAccessToken);

    // Step 4: Fetch Facebook User Data
    const fbUserResponse = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${finalAccessToken}`
    );
    if (!fbUserResponse.ok) throw new Error('Failed to fetch Facebook user data.');
    const fbUser = await fbUserResponse.json();
    const { id: fb_id, name, email } = fbUser;
    console.log('[DEBUG] Facebook User Data:', fbUser);

    // Step 5: Fetch Facebook Pages
    const pagesResponse = await fetch(
      `https://graph.facebook.com/me/accounts?access_token=${finalAccessToken}`
    );
    if (!pagesResponse.ok) throw new Error('Failed to fetch Facebook pages.');
    const pagesData = await pagesResponse.json();
    const firstPage = pagesData.data[0];
    if (!firstPage) throw new Error('No Facebook pages found for the user.');

    console.log('[DEBUG] Using First Page:', firstPage);

    const pageAccessToken = firstPage.access_token;

    // Step 6: Upsert Page into the Pages Table
    // Step: Upsert Page into the Pages Table
const { data: existingPage, error: pageFetchError } = await supabase
  .from('pages')
  .select('id, business_id') // Select the primary key and business_id
  .eq('page_id', firstPage.id)
  .single();

if (pageFetchError && pageFetchError.code !== 'PGRST116') { // Handle only critical errors
  throw new Error(`Error checking existing page with page_id ${firstPage.id}: ${pageFetchError.message}`);
}

if (existingPage) {
  // If the page exists, update its information
  const { error: pageUpdateError } = await supabase
    .from('pages')
    .update({
      name: firstPage.name,
      page_access_token: pageAccessToken, // Update the access token
      business_id: user.business_id, // Ensure the correct business_id is linked
    })
    .eq('id', existingPage.id); // Use the primary key for the update

  if (pageUpdateError) {
    throw new Error(`Page update failed for existing page_id ${firstPage.id}: ${pageUpdateError.message}`);
  }

  console.log(`[INFO] Page updated successfully for page_id ${firstPage.id}, linked to business_id ${user.business_id}`);
} else {
  // If the page does not exist, insert it
  const { data: newPage, error: pageInsertError } = await supabase
    .from('pages')
    .insert({
      page_id: firstPage.id, // Unique identifier for the page
      name: firstPage.name,
      page_access_token: pageAccessToken,
      business_id: user.business_id, // Link the business_id
    })
    .select()
    .single();

  if (pageInsertError) {
    throw new Error(`Page insert failed for page_id ${firstPage.id}: ${pageInsertError.message}`);
  }

  console.log(`[INFO] Page inserted successfully with page_id ${firstPage.id}, linked to business_id ${user.business_id}`);
}


    // Step 7: Fetch Instagram Business ID for the Page
    const fetchedIgId = await fetchInstagramIdFromFacebook(firstPage.id, pageAccessToken);
    if (!fetchedIgId) {
      console.warn('[WARN] Failed to fetch Instagram Business ID (ig_id) from Facebook. Proceeding without it.');
    } else {
      console.log(`[DEBUG] Fetched and mapped Instagram Business ID (ig_id): ${fetchedIgId}`);
    }

    // Step 8: Upsert Business Owner in Supabase
    const { data: user, error: userError } = await supabase
      .from('business_owners')
      .upsert(
        {
          fb_id,
          name,
          email,
          page_id: firstPage.id,
          ig_id: fetchedIgId || null,
          user_access_token: finalAccessToken,
        },
        { onConflict: ['fb_id'] }
      )
      .select()
      .single();

    if (userError) throw new Error(`User upsert failed: ${userError.message}`);
    console.log('[DEBUG] Business Owner Upserted:', user);

    // Step 9: Upsert Business
    const businessData = {
      business_owner_id: user.id,
      name: `${name}'s Business`,
      page_id: firstPage.id,
      ig_id: fetchedIgId || null,
    };

    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .upsert(businessData, { onConflict: ['business_owner_id'] })
      .select()
      .single();

    if (businessError) throw new Error(`Business upsert failed: ${businessError.message}`);
    console.log('[DEBUG] Business Upserted:', business);

    // Step 10: Set Secure Cookies
    res.cookie('authToken', finalAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None',
      maxAge: 3600000, // 1 hour
    });
    res.cookie('businessOwnerId', user.id.toString(), {
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

    // Step 11: Send Response
    return res.status(200).json({
      message: 'Login successful',
      businessOwnerId: user.id,
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
