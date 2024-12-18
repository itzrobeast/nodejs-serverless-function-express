import express from 'express';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch'; // Use native fetch if available
import Joi from 'joi'; // For data validation
import rateLimit from 'express-rate-limit'; // For rate limiting

const router = express.Router();

// Define Joi validation schema
const loginSchema = Joi.object({
  accessToken: Joi.string().required(),
  selectedPageId: Joi.string().optional(), // Optional: If allowing client to specify
});

// Rate limiter to prevent abuse
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many login attempts from this IP, please try again later.',
});

// Helper function to fetch all Facebook pages with pagination
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

// Function to ensure the page exists in the 'pages' table using upsert
const ensurePageExists = async (pageId, pageName, accessToken) => {
  try {
    const { data, error } = await supabase
      .from('pages')
      .upsert([
        {
          id: pageId,
          name: pageName,
          access_token: accessToken,
        },
      ], { onConflict: 'id' })
      .select('*');

    if (error) {
      console.error(`[ERROR] Upsert failed for page_id=${pageId}:`, error);
      throw error;
    }

    console.log(`[DEBUG] Page upserted successfully:`, data);
    return data;
  } catch (err) {
    console.error(`[ERROR] Exception during upsert for page_id=${pageId}:`, err);
    throw err;
  }
};

/**
 * POST /auth/login
 * Authenticates the user using Facebook access token and manages user and business data.
 */
router.post('/', loginLimiter, async (req, res) => {
  try {
    // 1. Validate incoming request
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      console.error('[ERROR] Validation Failed:', error.details);
      return res.status(400).json({ error: 'Invalid request data', details: error.details });
    }

    const { accessToken, selectedPageId } = value;

    console.log('[DEBUG] Access token received for authentication.');

    // 2. Verify the Facebook user token
    const fbResponse = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`
    );

    if (!fbResponse.ok) {
      console.error('[ERROR] Invalid Facebook token:', fbResponse.statusText);
      return res.status(401).json({ error: 'Invalid Facebook token' });
    }

    const fbData = await fbResponse.json();
    console.log('[DEBUG] Facebook user data fetched:', { id: fbData.id, name: fbData.name, email: fbData.email });

    // 3. Upsert user in Supabase 'users' table
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

    // 4. Validate and Extract `userId`
    const userId = user.id;
    if (typeof userId !== 'number') {
      console.error('[ERROR] user.id is not a valid integer:', userId);
      return res.status(500).json({ error: 'Invalid user ID from Supabase.' });
    }

    // 5. Fetch all Facebook pages
    const pagesData = await fetchAllPages(accessToken);
    console.log('[DEBUG] /me/accounts returned:', pagesData);

    if (!Array.isArray(pagesData) || pagesData.length === 0) {
      console.warn('[WARN] No Facebook pages found for this user.');
      // Depending on your application's logic, decide whether to allow login without pages
      // For this example, we'll proceed without assigning a page_id
    }

    // 6. Upsert pages into 'pages' table before creating/updating business
    const pageUpsertPromises = pagesData.map(async (pageInfo) => {
      try {
        await ensurePageExists(pageInfo.id, pageInfo.name || 'Unnamed Page', pageInfo.access_token);
      } catch (err) {
        console.error(`[ERROR] Failed to upsert page_id=${pageInfo.id}:`, err);
        // Decide whether to halt the process or continue based on your requirements
      }
    });

    await Promise.all(pageUpsertPromises);
    console.log('[DEBUG] All pages upserted successfully.');

    // 7. Determine which page to assign as `page_id`
    let pageIdToAssign = null;
    if (selectedPageId) {
      // Client has specified a page
      const selectedPage = pagesData.find(page => page.id === selectedPageId);
      if (selectedPage) {
        pageIdToAssign = selectedPage.id;
      } else {
        console.warn('[WARN] Selected page_id not found in fetched pages.');
      }
    } else if (pagesData.length > 0) {
      // Default to the first page
      pageIdToAssign = pagesData[0].id;
    }

    if (pageIdToAssign) {
      // Validate that the page exists in 'pages' table
      const { data: existingPage, error: pageCheckError } = await supabase
        .from('pages')
        .select('*')
        .eq('id', pageIdToAssign)
        .single();

      if (pageCheckError) {
        console.error(`[ERROR] Assigned page_id=${pageIdToAssign} does not exist in 'pages' table:`, pageCheckError);
        return res.status(500).json({ error: 'Assigned page does not exist.' });
      }

      console.log(`[DEBUG] Assigned page_id=${pageIdToAssign} confirmed in 'pages' table.`);
    }

    // 8. Upsert business for the user in Supabase 'businesses' table
    let { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (businessError) {
      if (businessError.code === 'PGRST116') { // Not Found
        console.log('[DEBUG] Business not found. Creating new business.');

        // Only assign page_id if available
        const businessData = {
          user_id: userId,
          name: `${fbData.name}'s Business`,
        };

        if (pageIdToAssign) {
          businessData.page_id = pageIdToAssign;
        }

        const { data: newBusiness, error: createBusinessError } = await supabase
          .from('businesses')
          .insert(businessData)
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

      // Optionally, update page_id if it's null and a page is available
      if (!business.page_id && pageIdToAssign) {
        const { data: updatedBusiness, error: updateBusinessError } = await supabase
          .from('businesses')
          .update({ page_id: pageIdToAssign })
          .eq('id', business.id)
          .select('*')
          .single();

        if (updateBusinessError) {
          console.error('[ERROR] Failed to update business with page_id:', updateBusinessError);
        } else {
          business = updatedBusiness;
          console.log('[DEBUG] Business updated with page_id:', business);
        }
      }
    }

    // 9. Upsert Page Access Tokens
    if (Array.isArray(pagesData) && pagesData.length > 0) {
      const pagePromises = pagesData.map(async (pageInfo) => {
        const pageId = pageInfo.id;
        const pageAccessToken = pageInfo.access_token;

        // At this point, all pages have been upserted into 'pages' table
        try {
          const { data: existingPageRow, error: fetchPageError } = await supabase
            .from('page_access_tokens')
            .select('*')
            .eq('user_id', userId)
            .eq('business_id', business.id)
            .eq('page_id', pageId)
            .single();

          if (fetchPageError) {
            if (fetchPageError.code === 'PGRST116') { // Not Found
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
              } else {
                console.log(`[DEBUG] Page token inserted for page_id=${pageId}.`);
              }
            } else {
              console.error(`[ERROR] Fetching existing page token for page_id=${pageId}:`, fetchPageError);
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
            } else {
              console.log(`[DEBUG] Page token updated for page_id=${pageId}.`);
            }
          }
        } catch (err) {
          console.error(`[ERROR] Processing page_access_tokens for page_id=${pageId}:`, err);
        }
      });

      await Promise.all(pagePromises);
      console.log('[DEBUG] All page access tokens upserted.');
    }

    // 10. Set cookies for authentication
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

    // 11. Send JSON response
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
        page_id: business.page_id, // Now should be populated
      },
    });
  } catch (err) {
    console.error('[ERROR] Login failed:', err); // Avoid logging sensitive data
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
