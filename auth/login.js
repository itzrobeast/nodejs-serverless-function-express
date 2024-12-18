import express from 'express';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch'; // Fetch API
import Joi from 'joi'; // For input validation
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Input Validation Schema
const loginSchema = Joi.object({
  accessToken: Joi.string().required(),
});

// Rate Limiter
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Prevent abuse
  message: 'Too many requests, please try again later.',
});

// Master Login Route
router.post('/', loginLimiter, async (req, res) => {
  // 1. Validate request data
  const { error, value } = loginSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { accessToken } = value;

  let fbUser, pagesData;
  const transaction = supabase.transaction();

  try {
    // 2. Verify Facebook User
    const fbResponse = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`
    );
    if (!fbResponse.ok) throw new Error('Invalid Facebook access token');

    fbUser = await fbResponse.json();
    console.log('[DEBUG] FB User Data:', fbUser);

    // 3. Fetch all Facebook Pages
    pagesData = await fetchPages(accessToken);
    if (!pagesData || pagesData.length === 0)
      throw new Error('No Facebook pages found');

    // Begin Transaction to Ensure Atomic Inserts
    await transaction.begin();

    // 4. Upsert User
    const { data: user, error: userError } = await transaction
      .from('users')
      .upsert([
        {
          fb_id: fbUser.id,
          name: fbUser.name,
          email: fbUser.email,
          ig_id: fbUser.id, // Ensure ig_id is the MAIN ACCOUNT's IG ID
        },
      ], { onConflict: 'fb_id' })
      .select()
      .single();

    if (userError) throw userError;

    console.log('[DEBUG] User Inserted:', user);

    // 5. Upsert Pages
    const pageUpserts = pagesData.map(async (page) => {
      await transaction.from('pages').upsert({
        id: page.id,
        name: page.name,
        access_token: page.access_token,
        business_id: null,
      }, { onConflict: 'id' });
    });
    await Promise.all(pageUpserts);

    console.log('[DEBUG] Pages Inserted.');

    // 6. Upsert Business and Link Page
    const { data: business, error: businessError } = await transaction
      .from('businesses')
      .upsert([
        {
          user_id: user.id,
          name: `${user.name}'s Business`,
          page_id: pagesData[0].id, // Link the first page as the default
          ig_id: fbUser.id,
        },
      ], { onConflict: 'user_id' })
      .select()
      .single();

    if (businessError) throw businessError;

    console.log('[DEBUG] Business Inserted:', business);

    // 7. Commit the Transaction
    await transaction.commit();

    // 8. Set Cookies for User Authentication
    res.cookie('authToken', accessToken, { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });
    res.cookie('userId', user.id.toString(), { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });
    res.cookie('businessId', business.id.toString(), { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });

    return res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        fb_id: user.fb_id,
        name: user.name,
        email: user.email,
      },
      business: {
        id: business.id,
        name: business.name,
        page_id: business.page_id,
      },
    });
  } catch (err) {
    console.error('[ERROR] Transaction failed:', err);
    await transaction.rollback();
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// Helper Function: Fetch Facebook Pages
const fetchPages = async (accessToken) => {
  let pages = [];
  let nextUrl = `https://graph.facebook.com/me/accounts?access_token=${accessToken}`;

  while (nextUrl) {
    const response = await fetch(nextUrl);
    if (!response.ok) throw new Error('Failed to fetch Facebook pages');

    const data = await response.json();
    pages = pages.concat(data.data);
    nextUrl = data.paging?.next || null;
  }

  return pages;
};

export default router;
