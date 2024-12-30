import express from 'express';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import { fetchInstagramIdFromFacebook } from '../helpers.js'; // Import the helper function

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
    const fbResponse = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`
    );
    if (!fbResponse.ok) throw new Error('Invalid Facebook Access Token');
    const fbUser = await fbResponse.json();
    const { id: fb_id, name, email } = fbUser;
    console.log('[DEBUG] Facebook User Data:', fbUser);

    // Step 2: Fetch Facebook Pages
    const pagesResponse = await fetch(
      `https://graph.facebook.com/me/accounts?access_token=${accessToken}`
    );
    if (!pagesResponse.ok) throw new Error('Failed to fetch Facebook pages.');
    const pagesData = await pagesResponse.json();
    const firstPage = pagesData.data[0];
    console.log('[DEBUG] Using First Page:', firstPage);

    // Step 3: Fetch Instagram Business ID for the Page
    const igId = await fetchInstagramIdFromFacebook(firstPage.id, firstPage.access_token); // Use the imported function
    if (!igId) {
      console.warn('[WARN] Instagram Business ID not found for the page. Skipping Instagram linkage.');
    } else {
      console.log(`[DEBUG] Fetched Instagram Business ID: ${igId}`);
    }

    // Step 4: Upsert User in Supabase (example, unchanged)
    const { data: user, error: userError } = await supabase
      .from('users')
      .upsert(
        {
          fb_id,
          name,
          email,
          ig_id: igId || null, // Accept null if IG ID is not found
        },
        { onConflict: ['fb_id'] }
      )
      .select()
      .single();

    if (userError) throw new Error(`User upsert failed: ${userError.message}`);
    console.log('[DEBUG] User Upserted:', user);

    // Add more steps as required...

    // Send response
    res.status(200).json({ message: 'Login successful', user });
  } catch (err) {
    console.error('[ERROR]', err.message);
    return res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

export default router;
