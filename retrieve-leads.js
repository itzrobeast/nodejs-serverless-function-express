// retrieve-leads.js
import fetch from 'node-fetch';
import express from 'express';
import supabase from './supabaseClient.js';

const router = express.Router();

/**
 * Function to fetch leads from Meta (Facebook) API
 * @param {string} accessToken - Facebook access token
 * @param {string} pageId - Facebook Page ID
 * @returns {Array} - Array of leads
 */
const getLeadsFromMeta = async (accessToken, pageId) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v14.0/${pageId}/leads?access_token=${accessToken}`
    );
    if (!response.ok) throw new Error('Failed to retrieve leads');
    const data = await response.json();
    return data.data || []; // Array of leads
  } catch (error) {
    console.error('[ERROR] Failed to retrieve leads from Meta:', error.message);
    return [];
  }
};

// GET Handler for Leads Retrieval
router.get('/', async (req, res) => {
  // Extract cookies from the request
  const cookies = req.headers.cookie;
  if (!cookies) {
    return res.status(401).json({ error: 'Authentication required. No cookies found.' });
  }

  // Parse cookies
  const parsedCookies = parseCookies(cookies);
  const authToken = parsedCookies.authToken;
  const userId = parsedCookies.userId;
  const businessId = parsedCookies.businessId;

  console.log('[DEBUG] Parsed Cookies:', { authToken, userId, businessId });

  // Validate presence of necessary cookies
  if (!authToken || !userId || !businessId) {
    return res.status(401).json({ error: 'Authentication required. Missing authToken, userId, or businessId.' });
  }

  try {
    // Validate authToken with Facebook
    const isValid = await validateFacebookToken(authToken, userId);
    if (!isValid) {
      return res.status(403).json({ error: 'Invalid or expired authentication token.' });
    }

    // Authorization: Verify user-business association
    const { data: userBusiness, error: userBusinessError } = await supabase
      .from('user_businesses')
      .select('*')
      .eq('user_id', userId)
      .eq('business_id', businessId)
      .single();

    if (userBusinessError || !userBusiness) {
      console.error('[ERROR] User not associated with the business:', userBusinessError?.message);
      return res.status(403).json({ error: 'Unauthorized access to this business.' });
    }

    // Fetch business data to get access_token and page_id
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('access_token, page_id')
      .eq('id', businessId)
      .single();

    if (businessError || !business) {
      console.error('[ERROR] Business not found or database error:', businessError?.message);
      return res.status(404).json({ error: 'Business not found.' });
    }

    const { access_token, page_id } = business;

    if (!access_token || !page_id) {
      return res.status(400).json({ error: 'Page ID or Access Token missing.' });
    }

    // Fetch leads from Meta API
    const leads = await getLeadsFromMeta(access_token, page_id);

    console.log('[DEBUG] Retrieved leads:', leads);

    res.status(200).json({ leads });
  } catch (error) {
    console.error('[ERROR] Failed to retrieve leads:', error.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;

/**
 * Helper function to parse cookies
 * @param {string} cookieHeader - The cookie header from the request
 * @returns {Object} - Parsed cookies as key-value pairs
 */
const parseCookies = (cookieHeader) => {
  const cookies = {};
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [key, value] = pair.trim().split('=');
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
};

/**
 * Helper function to validate Facebook authToken
 * @param {string} authToken - The Facebook authToken to validate
 * @param {string} userId - The userId associated with the token
 * @returns {boolean} - Returns true if the token is valid, false otherwise
 */
const validateFacebookToken = async (authToken, userId) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/debug_token?input_token=${authToken}&access_token=${process.env.NEXT_PUBLIC_FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`
    );
    const data = await response.json();

    console.log('[DEBUG] Facebook Token Validation Response:', data);

    if (data.data && data.data.is_valid && data.data.user_id === userId) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error('[ERROR] Failed to validate Facebook token:', error.message);
    return false;
  }
};
