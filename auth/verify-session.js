import axios from 'axios';
import supabase from '../supabaseClient.js';
import cookie from 'cookie';

// Ensure critical environment variables are set
if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
  throw new Error('[CRITICAL] FACEBOOK_APP_ID or FACEBOOK_APP_SECRET is not defined in environment variables');
}

/**
 * Validates the Facebook token using the Graph API.
 * @param {string} token - The user's Facebook access token.
 * @returns {Object} - The validated token details, including user_id and scopes.
 * @throws {Error} - If token validation fails.
 */
const validateFacebookToken = async (token) => {
  try {
    console.log(`[DEBUG] Validating Facebook token: ${token}`);
    const appAccessToken = `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`;
    const response = await axios.get('https://graph.facebook.com/debug_token', {
      params: {
        input_token: token,
        access_token: appAccessToken,
      },
    });

    const { data } = response;
    if (!data || !data.data || !data.data.is_valid) {
      const errorMessage = data.data.error ? data.data.error.message : 'Invalid token';
      throw new Error(errorMessage);
    }

    console.log('[DEBUG] Facebook Token Validated:', data.data);
    return data.data;
  } catch (error) {
    console.error('[ERROR] Facebook token validation failed:', error.message);
    throw new Error('Your session has expired. Please log in again.');
  }
};

export default async function handler(req, res) {
  try {
    console.log('[DEBUG] Incoming request to /auth/verify-session');

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Parse cookies to get the token
    const cookies = req.headers.cookie ? cookie.parse(req.headers.cookie) : {};
    let token = cookies.authToken;

    // Fallback: Retrieve token from Authorization header
    if (!token && req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
    }

    if (!token) {
      console.error('[ERROR] Missing token');
      return res.status(401).json({ error: 'Unauthorized: Token not found' });
    }

    // Validate the Facebook token
    const tokenDetails = await validateFacebookToken(token);

    // Extract user details
    const user = {
      fb_id: tokenDetails.user_id,
      scopes: tokenDetails.scopes,
    };

    // Check if `business_id` is provided in query params
    const businessId = req.query.business_id;
    if (businessId) {
      console.log(`[DEBUG] Validating business ID: ${businessId}`);

      const { data: businessData, error: businessError } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', businessId)
        .eq('owner_id', user.fb_id) // Ensure the user owns the business
        .single();

      if (businessError) {
        console.error('[ERROR] Supabase Error:', businessError.message);
        return res.status(500).json({ error: 'Database error while validating business' });
      }

      if (!businessData) {
        console.error('[ERROR] Business not found or unauthorized access');
        return res.status(404).json({ error: 'Business not found or unauthorized access' });
      }

      console.log('[DEBUG] Business data retrieved:', businessData);
      return res.status(200).json({
        message: 'Session verified successfully',
        user,
        business: businessData,
      });
    }

    console.log('[DEBUG] No business ID provided, returning user data only.');
    return res.status(200).json({
      message: 'Session verified successfully',
      user,
    });
  } catch (error) {
    console.error('[ERROR] Unexpected error:', error.message);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
