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
// Helper: Upsert All Pages
// --------------------------------------------------
async function upsertAllPages(pagesData = []) {
  const upsertedPages = [];

  for (const page of pagesData) {
    const pageAccessToken = page.access_token;
    // Optional IG fetch
    const fetchedIgId = await fetchInstagramIdFromFacebook(page.id, pageAccessToken);

    // Upsert or insert the page
    const { data: pageRecord, error: pageError } = await supabase
      .from('pages')
      .upsert(
        {
          page_id: page.id,           // Unique external ID from Facebook
          name: page.name,
          category: page.category || null,
          page_access_token: pageAccessToken,
          ig_id: fetchedIgId || null, // can be null if no Instagram
        },
        { onConflict: 'page_id' }
      )
      .select('id, page_id, ig_id')
      .single();

    if (pageError) {
      throw new Error(`Page upsert failed: ${pageError.message}`);
    }

    // Keep track of the new or existing ID
    upsertedPages.push({
      ...page,
      id: pageRecord.id,            // The primary key in "pages" table
      ig_id: pageRecord.ig_id,      // The final IG ID in DB (could differ if existing)
    });
  }

  return upsertedPages;
}

// --------------------------------------------------
// POST /auth/login
// --------------------------------------------------
router.post('/', loginLimiter, async (req, res) => {
  try {
    // 1. Validate input
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    const { accessToken } = value;

    // 2. Validate & Refresh Token
    const tokenDetails = await validateFacebookToken(accessToken);
    if (!tokenDetails.isValid) {
      throw new Error('Invalid or expired Facebook token. Please log in again.');
    }
    const refreshedToken = await refreshUserAccessToken(tokenDetails.userId, accessToken);
    const finalAccessToken = refreshedToken || accessToken;

    // 3. Fetch Facebook User Data
    const fbUserRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${finalAccessToken}`
    );
    if (!fbUserRes.ok) {
      throw new Error('Failed to fetch Facebook user data.');
    }
    const fbUser = await fbUserRes.json();
    const { id: fb_id, name, email } = fbUser;

    // 4. Fetch Facebook Pages
    const pagesRes = await fetch(
      `https://graph.facebook.com/me/accounts?access_token=${finalAccessToken}`
    );
    if (!pagesRes.ok) {
      throw new Error('Failed to fetch Facebook pages.');
    }
    const pagesData = await pagesRes.json();
    if (!pagesData?.data || pagesData.data.length === 0) {
      throw new Error('No Facebook pages found for this user.');
    }

    // 5. Upsert ALL pages first (so we have valid page IDs in DB)
    const upsertedPages = await upsertAllPages(pagesData.data);
    // Use the *first* page as "primary" for business_owners & business
    const primaryPage = upsertedPages[0];
    if (!primaryPage?.id) {
      throw new Error('No valid primary page ID found.');
    }

    // 6. Upsert Business Owner (linked to the primary page's ID)
    const { data: owner, error: ownerError } = await supabase
      .from('business_owners')
      .upsert(
        {
          fb_id,                 // unique key if onConflict: 'fb_id'
          name,
          email,
          page_id: primaryPage.id,        // FK => pages.id
          ig_id: primaryPage.ig_id || null,
          user_access_token: finalAccessToken,
        },
        { onConflict: 'fb_id' } // updates if fb_id already exists
      )
      .select()
      .single();

    if (ownerError) {
      throw new Error(`User upsert failed: ${ownerError.message}`);
    }

    // 7. Upsert Business (linked to business_owners.id)
    const businessPayload = {
      business_owner_id: owner.id, // ties to business_owners
      name: `${name}'s Business`,
      page_id: primaryPage.id,     // optional reference to primary page
      ig_id: primaryPage.ig_id || null,
    };

    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .upsert(businessPayload, { onConflict: 'business_owner_id' })
      .select()
      .single();

    if (businessError) {
      throw new Error(`Business upsert failed: ${businessError.message}`);
    }

    // 8. Link the Business ID in business_owners
    const { error: ownerUpdateError } = await supabase
      .from('business_owners')
      .update({ business_id: business.id })
      .eq('id', owner.id);
    if (ownerUpdateError) {
      throw new Error(`Failed to update business_id in business_owners: ${ownerUpdateError.message}`);
    }

    // 9. (Optional) Upsert the 'primary' page to point to this business if needed
    //    If your "pages" table has a "business_id" column you want to link:
    const { error: pageUpdateError } = await supabase
      .from('pages')
      .update({ business_id: business.id })
      .eq('id', primaryPage.id);
    if (pageUpdateError) {
      console.warn('[WARN] Failed to set business_id on pages table:', pageUpdateError.message);
    }

    // 10. No Data Loss: (We skip mass deletions in instagram_users or conversations)
    //     If you do want to upsert or sync IG data, do it here conditionally.
    //     Example (only if business.ig_id is not null):
    /*
    if (business.ig_id) {
      const { error: igConvError } = await supabase
        .from('instagram_conversations')
        .upsert({ ig_id: business.ig_id, conversation_data: {} })
        .select();
      if (igConvError) {
        console.warn('[WARN] IG convo upsert failed:', igConvError.message);
      }
    }
    */

    // 11. Set Secure Cookies
    res.cookie('authToken', finalAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None',
      maxAge: 3600000,
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

    // 12. Final success response
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
