import express from 'express';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import { fetchInstagramIdFromFacebook } from '../helpers.js';

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

    // Step 1: Fetch Facebook User Data
    const fbResponse = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`);
    if (!fbResponse.ok) throw new Error('Invalid Facebook Access Token');
    const fbUser = await fbResponse.json();
    const { id: fb_id, name, email } = fbUser;
    console.log('[DEBUG] Facebook User Data:', fbUser);

    // Step 2: Fetch Facebook Pages
    const pagesResponse = await fetch(`https://graph.facebook.com/me/accounts?access_token=${accessToken}`);
    if (!pagesResponse.ok) throw new Error('Failed to fetch Facebook pages.');
    const pagesData = await pagesResponse.json();
    const firstPage = pagesData.data[0];
    console.log('[DEBUG] Using First Page:', firstPage);

    // Step 3: Fetch Instagram Business ID for the Page
    const fetchedIgId = await fetchInstagramIdFromFacebook(firstPage.id, firstPage.access_token);
    const igId = fetchedIgId; // Map Instagram Business Account ID to ig_id

    if (!igId) {
      console.warn('[WARN] Instagram Business ID not found for the page. Skipping Instagram linkage.');
    } else {
      console.log(`[DEBUG] Fetched and mapped Instagram Business ID (ig_id): ${igId}`);
    }

    console.log(`[DEBUG] Preparing to upsert user with ig_id: ${igId}`);
    // Step 4: Upsert User in Supabase
    const { data: user, error: userError } = await supabase
      .from('users')
      .upsert(
        {
          fb_id,
          name,
          email,
          ig_id: igId || null, // Accept null if IG ID is not found
          user_access_token: accessToken, // Save the user access token
        },
        { onConflict: ['fb_id'] }
      )
      .select()
      .single();

    if (userError) throw new Error(`User upsert failed: ${userError.message}`);
    console.log('[DEBUG] User Upserted:', user);

    console.log(`[DEBUG] Preparing to upsert business with ig_id: ${igId}`);
    // Step 5: Upsert Business
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

    if (businessError) throw new Error(`Business upsert failed: ${businessError.message}`);
    console.log('[DEBUG] Business Upserted:', business);

    // Step 6: Set Secure Cookies
    res.cookie('authToken', accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      maxAge: 3600000, // 1 hour
    });
    res.cookie('userId', user.id.toString(), {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      maxAge: 3600000, // 1 hour
    });
    res.cookie('businessId', business.id.toString(), {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      maxAge: 3600000, // 1 hour
    });

    // Step 7: Send Response
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
    console.log('[DEBUG] Facebook User Data:', fbUser);

    // Step 2: Fetch Facebook Pages
    const pagesResponse = await fetch(`https://graph.facebook.com/me/accounts?access_token=${accessToken}`);
    if (!pagesResponse.ok) throw new Error('Failed to fetch Facebook pages.');
    const pagesData = await pagesResponse.json();
    const firstPage = pagesData.data[0];
    console.log('[DEBUG] Using First Page:', firstPage);

    // Step 3: Fetch Instagram Business ID for the Page
    const fetchedIgId = await fetchInstagramIdFromFacebook(firstPage.id, firstPage.access_token);
    const igId = fetchedIgId; // Map Instagram Business Account ID to ig_id

    if (!igId) {
      console.warn('[WARN] Instagram Business ID not found for the page. Skipping Instagram linkage.');
    } else {
      console.log(`[DEBUG] Fetched and mapped Instagram Business ID (ig_id): ${igId}`);
    }

    console.log(`[DEBUG] Preparing to upsert user with ig_id: ${igId}`);
    // Step 4: Upsert User in Supabase
    const { data: user, error: userError } = await supabase
      .from('users')
      .upsert(
        {
          fb_id,
          name,
          email,
          ig_id: igId || null, // Accept null if IG ID is not found
          user_access_token: accessToken, // Save the user access token
        },
        { onConflict: ['fb_id'] }
      )
      .select()
      .single();

    if (userError) throw new Error(`User upsert failed: ${userError.message}`);
    console.log('[DEBUG] User Upserted:', user);

    console.log(`[DEBUG] Preparing to upsert business with ig_id: ${igId}`);
    // Step 5: Upsert Business
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

    if (businessError) throw new Error(`Business upsert failed: ${businessError.message}`);
    console.log('[DEBUG] Business Upserted:', business);

    // Step 6: Set Secure Cookies
    res.cookie('authToken', accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      maxAge: 3600000, // 1 hour
    });
    res.cookie('userId', user.id.toString(), {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      maxAge: 3600000, // 1 hour
    });
    res.cookie('businessId', business.id.toString(), {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      maxAge: 3600000, // 1 hour
    });

    // Step 7: Send Response
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
