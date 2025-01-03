import express from 'express';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import { fetchInstagramIdFromFacebook, validateFacebookToken  } from '../helpers.js';

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
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { accessToken } = value;
    
const fbResponse = await validateFacebookToken(accessToken);
console.log('[DEBUG] Token details:', fbResponse);

    // Step 1: Validate Facebook Token
    const tokenValidationResponse = await validateFacebookToken(accessToken);
    if (!tokenValidationResponse.isValid) {
      throw new Error('Invalid or expired Facebook token. Please log in again.');
    }
    console.log('[DEBUG] Facebook Token Validated:', tokenValidationResponse);

    // Step 2: Fetch Facebook User Data
    const fbResponse = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`);
    if (!fbResponse.ok) throw new Error('Invalid Facebook Access Token');
    const fbUser = await fbResponse.json();
    const { id: fb_id, name, email } = fbUser;
    console.log('[DEBUG] Facebook User Data:', fbUser);

    // Step 3: Fetch Facebook Pages
    const pagesResponse = await fetch(`https://graph.facebook.com/me/accounts?access_token=${accessToken}`);
    if (!pagesResponse.ok) throw new Error('Failed to fetch Facebook pages.');
    const pagesData = await pagesResponse.json();
    const firstPage = pagesData.data[0];
    console.log('[DEBUG] Using First Page:', firstPage);

    const pageAccessToken = firstPage.access_token;

    // Step 4: Refresh User Token if Expired
    const updatedAccessToken = await refreshUserAccessToken(fb_id, accessToken);
    console.log('[DEBUG] User Access Token Refreshed:', updatedAccessToken);

    // Step 5: Fetch Instagram Business ID for the Page
    const fetchedIgId = await fetchInstagramIdFromFacebook(firstPage.id, firstPage.access_token);
    if (!fetchedIgId) {
      console.error('[ERROR] Failed to fetch Instagram Business ID (ig_id) from Facebook');
    }
    console.log(`[DEBUG] Fetched and mapped Instagram Business ID (ig_id): ${fetchedIgId}`);

    // Step 6: Upsert Business Owner in Supabase
    const { data: user, error: userError } = await supabase
      .from('business_owners')
      .upsert(
        {
          fb_id,
          name,
          email,
          page_id: firstPage.id,
          ig_id: fetchedIgId || null,
          user_access_token: updatedAccessToken,
        },
        { onConflict: ['fb_id'] }
      )
      .select()
      .single();

    if (userError) throw new Error(`User upsert failed: ${userError.message}`);
    console.log('[DEBUG] Business Owner Upserted:', user);

    // Step 7: Upsert Business
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

    // Step 8: Set Secure Cookies
    res.cookie('authToken', updatedAccessToken, {
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

    // Step 9: Send Response
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
