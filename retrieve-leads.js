// retrieve-leads.js
import express from 'express';
import fetch from 'node-fetch';
import supabase from './supabaseClient.js';

const router = express.Router();

/**
 * Helper function to fetch leads from the Facebook Graph API using a Page Token.
 * @param {string} pageId - The FB Page ID
 * @param {string} pageAccessToken - The page-specific access token
 * @returns {Array} Array of lead objects
 */
const getLeadsFromMeta = async (pageId, pageAccessToken) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v14.0/${pageId}/leads?access_token=${pageAccessToken}`
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to retrieve leads: ${errorText}`);
    }
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('[ERROR] Failed to fetch leads:', error.message);
    return [];
  }
};

/**
 * Optionally validate the page access token using debug_token.
 * If the token belongs to the same app, 'is_valid' should be true.
 * For a page token, user_id may not match the user’s FB ID. We mainly check 'is_valid'.
 */
const validatePageToken = async (pageAccessToken) => {
  try {
    const appId = process.env.FACEBOOK_APP_ID;         // Make sure this is the correct App ID
    const appSecret = process.env.FACEBOOK_APP_SECRET; // And the matching secret
    if (!appId || !appSecret) {
      console.warn('[WARN] Missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET for token validation.');
      return true; // skip validation if env is missing
    }

    const response = await fetch(
      `https://graph.facebook.com/debug_token?input_token=${pageAccessToken}&access_token=${appId}|${appSecret}`
    );
    const data = await response.json();
    console.log('[DEBUG] Page Token Validation Response:', data);

    if (data.data && data.data.is_valid) {
      return true;
    } else {
      console.error('[ERROR] Page token is invalid or expired:', data);
      return false;
    }
  } catch (error) {
    console.error('[ERROR] Failed to validate page token:', error.message);
    // If we fail to validate, might default to false
    return false;
  }
};

/**
 * GET /retrieve-leads
 * Requires userId & businessId cookies. Then queries page_access_tokens table
 * to find the page token, optionally validates it, and fetches leads from FB.
 */
router.get('/', async (req, res) => {
  try {
    const { userId, businessId } = req.cookies || {};

    console.log('[DEBUG] Parsed Cookies:', { userId, businessId });
    if (!userId || !businessId) {
      return res.status(400).json({ error: 'Missing userId or businessId in cookies.' });
    }

    // 1. Retrieve the page token from page_access_tokens
    const { data: pageTokenData, error: pageTokenError } = await supabase
      .from('page_access_tokens')
      .select('page_id, page_access_token')
      .eq('user_id', userId)
      .eq('business_id', businessId)
      .single();

    if (pageTokenError || !pageTokenData) {
      console.error('[ERROR] Page access token not found:', pageTokenError?.message);
      return res.status(404).json({ error: 'Page access token not found.' });
    }

    const { page_id: pageId, page_access_token: pageAccessToken } = pageTokenData;
    console.log('[DEBUG] Retrieved Page Token:', { pageId, pageAccessToken });

    // 2. (Optional) Validate the page token 
    const isValid = await validatePageToken(pageAccessToken);
    if (!isValid) {
      return res.status(403).json({ error: 'Invalid or expired page access token.' });
    }

    // 3. Fetch leads using the page token
    const leads = await getLeadsFromMeta(pageId, pageAccessToken);
    console.log('[DEBUG] Retrieved Leads:', leads);

    return res.status(200).json({ leads });
  } catch (error) {
    console.error('[ERROR] Failed to retrieve leads:', error.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
