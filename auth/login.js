import express from 'express';
import supabase from '../supabaseClient.js';
// Use native fetch if available in your Node.js version
import fetch from 'node-fetch'; // Optional if native fetch is supported

import Joi from 'joi'; // For data validation

const router = express.Router();

// Define Joi validation schema
const loginSchema = Joi.object({
  accessToken: Joi.string().required(),
});

/**
 * POST /login
 * Authenticates the user using Facebook access token and manages user and business data.
 */
router.post('/', async (req, res) => {
  try {
    // Validate incoming request
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      console.error('[ERROR] Validation Failed:', error.details);
      return res.status(400).json({ error: 'Invalid request data', details: error.details });
    }

    const { accessToken } = value;

    console.log('[DEBUG] Access token received for authentication.');

    // 1. Verify the Facebook user token
    const fbResponse = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`
    );

    if (!fbResponse.ok) {
      console.error('[ERROR] Invalid Facebook token:', fbResponse.statusText);
      return res.status(401).json({ error: 'Invalid Facebook token' });
    }

    const fbData = await fbResponse.json();
    console.log('[DEBUG] Facebook user data fetched:', { id: fbData.id, name: fbData.name, email: fbData.email });

    // 2. Upsert user in Supabase 'users' table
    let { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('fb_id', fbData.id)
      .single();

    if (userError) {
      if (userError.code === 'PGRST116') { // Not Found
        console.log('[DEBUG] User not found. Creating new user.');
        const { data: newUser, error: createUserError } = await supabase
          .from('users')
          .insert({
            fb_id: fbData.id,
            name: fbData.name,
            email: fbData.email,
          })
          .select('*')
          .single();

        if (createUserError) {
          console.error('[ERROR] Failed to create user:', createUserError);
          return res.status(500).json({ error: 'Failed to create user.' });
        }
        user = newUser;
        console.log('[DEBUG] New user created:', { id: user.id, fb_id: user.fb_id, name: user.name, email: user.email });
      } else {
        console.error('[ERROR] Error fetching user:', userError);
        return res.status(500).json({ error: 'Error fetching user.' });
      }
    } else {
      console.log('[DEBUG] User found:', { id: user.id, fb_id: user.fb_id, name: user.name, email: user.email });
    }

    // 3. Validate and Extract `userId`
    const userId = user.id;
    if (typeof userId !== 'number') {
      console.error('[ERROR] user.id is not a valid integer:', userId);
      return res.status(500).json({ error: 'Invalid user ID from Supabase.' });
    }

    // 4. Upsert business for the user in Supabase 'businesses' table
    let { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('*')
      .eq('user_id', userId) // Consistent with 'user_id' convention
      .single();

    if (businessError) {
      if (businessError.code === 'PGRST116') { // Not Found
        console.log('[DEBUG] Business not found. Creating new business.');
        const { data: newBusiness, error: createBusinessError } = await supabase
          .from('businesses')
          .insert({
            user_id: userId,
            name: `${fbData.name}'s Business`,
          })
          .select('*')
          .single();

        if (createBusinessError) {
          console.error('[ERROR] Failed to create business:', createBusinessError);
          return res.status(500).json({ error: 'Failed to create business.' });
        }
        business = newBusiness;
        console.log('[DEBUG] New business created:', { id: business.id, user_id: business.user_id, name: business.name });
      } else {
        console.error('[ERROR] Error fetching business:', businessError);
        return res.status(500).json({ error: 'Error fetching business.' });
      }
    } else {
      console.log('[DEBUG] Business found:', { id: business.id, user_id: business.user_id, name: business.name });
    }

    // 5. Fetch user’s Facebook pages & upsert page access tokens
    const fetchAllPages = async (accessToken) => {
      let pages = [];
      let nextPageUrl = `https://graph.facebook.com/me/accounts?access_token=${accessToken}`;

      while (nextPageUrl) {
        const response = await fetch(nextPageUrl);
        if (!response.ok) {
          console.error('[ERROR] Failed to fetch pages:', response.statusText);
          break;
        }
        const data = await response.json();
        pages = pages.concat(data.data);
        nextPageUrl = data.paging?.next || null;
      }

      return pages;
    };

    const pagesData = await fetchAllPages(accessToken);
    console.log('[DEBUG] /me/accounts returned:', pagesData);

    if (Array.isArray(pagesData)) {
      const pagePromises = pagesData.map(async (pageInfo) => {
        const pageId = pageInfo.id;
        const pageAccessToken = pageInfo.access_token;

        // Upsert into 'page_access_tokens' table
        let { data: existingPageRow, error: fetchPageError } = await supabase
          .from('page_access_tokens')
          .select('*')
          .eq('user_id', userId)
          .eq('business_id', business.id)
          .eq('page_id', pageId)
          .single();

        if (fetchPageError && fetchPageError.code !== 'PGRST116') {
          console.error(`[ERROR] Fetching existing page token row for page_id=${pageId}:`, fetchPageError);
          return;
        }

        if (!existingPageRow) {
          console.log(`[DEBUG] Inserting new page token for page_id=${pageId}.`);
          const { error: insertError } = await supabase
            .from('page_access_tokens')
            .insert([
              {
                user_id: userId,
                business_id: business.id,
                page_id: pageId,
                page_access_token: pageAccessToken,
              },
            ]);
          if (insertError) {
            console.error(`[ERROR] Failed to insert page token for page_id=${pageId}:`, insertError);
          }
        } else {
          console.log(`[DEBUG] Updating existing page token for page_id=${pageId}.`);
          const { error: updateError } = await supabase
            .from('page_access_tokens')
            .update({
              page_access_token: pageAccessToken,
            })
            .eq('id', existingPageRow.id);
          if (updateError) {
            console.error(`[ERROR] Failed to update page token for page_id=${pageId}:`, updateError);
          }
        }
      });

      await Promise.all(pagePromises);
    }

    // 6. Set cookies for authentication
    res.cookie('authToken', accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      maxAge: 3600000, // 1 hour
    });

    res.cookie('userId', userId.toString(), {
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

    console.log('[DEBUG] Cookies Set:', {
      authToken: 'Set', // Avoid logging actual tokens
      userId: userId,
      businessId: business.id,
    });

    // 7. Send JSON response
    return res.status(200).json({
      message: 'Login successful',
      userId: user.id,
      businessId: business.id,
      user: {
        id: user.id,
        fb_id: user.fb_id,
        name: user.name,
        email: user.email,
      },
      business: {
        id: business.id,
        name: business.name,
      },
    });
  } catch (err) {
    console.error('[ERROR] Login failed:', err); // Avoid logging sensitive data
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
