import express from 'express';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { accessToken } = req.body;

    // Validate input
    if (!accessToken) {
      console.log('[DEBUG] Missing access token in request body.');
      return res.status(400).json({ error: 'Missing access token' });
    }

    console.log('[DEBUG] Access token received.');

    // 1. Verify the Facebook user token
    const fbResponse = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`
    );

    if (!fbResponse.ok) {
      console.error('[ERROR] Invalid Facebook token:', fbResponse.statusText);
      return res.status(401).json({ error: 'Invalid Facebook token' });
    }

    const fbData = await fbResponse.json();
    console.log('[DEBUG] Facebook user data fetched:', fbData);

    // 2. Upsert user in DB
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
        console.log('[DEBUG] New user created:', user);
      } else {
        console.error('[ERROR] Error fetching user:', userError);
        return res.status(500).json({ error: 'Error fetching user.' });
      }
    } else {
      console.log('[DEBUG] User found:', user);
    }

    const ownerId = parseInt(user.id, 10);
    if (isNaN(ownerId)) {
      console.error('[ERROR] user.id is not a valid integer:', user.id);
      return res.status(500).json({ error: 'Invalid user ID from Supabase.' });
    }

    // 3. Upsert business for the user
    let { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('*')
      .eq('user_id', ownerId)
      .single();

    if (businessError) {
      if (businessError.code === 'PGRST116') { // Not Found
        console.log('[DEBUG] Business not found. Creating new business.');
        const { data: newBusiness, error: createBusinessError } = await supabase
          .from('businesses')
          .insert({
            user_id: ownerId,
            name: `${fbData.name}'s Business`,
          })
          .select('*')
          .single();

        if (createBusinessError) {
          console.error('[ERROR] Failed to create business:', createBusinessError);
          return res.status(500).json({ error: 'Failed to create business.' });
        }
        business = newBusiness;
        console.log('[DEBUG] New business created:', business);
      } else {
        console.error('[ERROR] Error fetching business:', businessError);
        return res.status(500).json({ error: 'Error fetching business.' });
      }
    } else {
      console.log('[DEBUG] Business found:', business);
    }

    // 4. Fetch user’s pages & upsert page tokens
    const pagesResponse = await fetch(`https://graph.facebook.com/me/accounts?access_token=${accessToken}`);
    if (!pagesResponse.ok) {
      console.error('[ERROR] Failed to fetch pages for user:', pagesResponse.statusText);
      // Not fatal for login, but means no pages were fetched
    } else {
      const pagesData = await pagesResponse.json();
      console.log('[DEBUG] /me/accounts returned:', pagesData?.data);

      if (Array.isArray(pagesData?.data)) {
        for (const pageInfo of pagesData.data) {
          const pageId = pageInfo.id;
          const pageAccessToken = pageInfo.access_token;

          // Upsert into page_access_tokens table
          let { data: existingPageRow, error: fetchPageError } = await supabase
            .from('page_access_tokens')
            .select('*')
            .eq('user_id', ownerId)
            .eq('business_id', business.id)
            .eq('page_id', pageId)
            .single();

          if (fetchPageError && fetchPageError.code !== 'PGRST116') {
            console.error('[ERROR] Fetching existing page token row:', fetchPageError);
            continue;
          }

          if (!existingPageRow) {
            console.log(`[DEBUG] Inserting new page token for page_id=${pageId}.`);
            const { error: insertError } = await supabase
              .from('page_access_tokens')
              .insert([
                {
                  user_id: ownerId,
                  business_id: business.id,
                  page_id: pageId,
                  page_access_token: pageAccessToken,
                },
              ]);
            if (insertError) {
              console.error('[ERROR] Failed to insert page token:', insertError);
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
              console.error('[ERROR] Failed to update page token:', updateError);
            }
          }
        }
      }
    }

    // 5. Set cookies for authentication
    res.cookie('authToken', accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      maxAge: 3600000, // 1 hour
    });

    res.cookie('userId', user.id?.toString(), {
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
      authToken: accessToken,
      userId: ownerId,
      businessId: business.id,
    });

    // 6. Send JSON response
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
    console.error('[ERROR] Login failed:', err); // Logs the entire error object
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
