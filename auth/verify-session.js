import axios from 'axios';
import cookie from 'cookie';

// Ensure critical environment variables are set
if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
  throw new Error('[CRITICAL] FACEBOOK_APP_ID or FACEBOOK_APP_SECRET is not defined in environment variables');
}

// Validate Facebook token
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
      const errorMessage = data?.data?.error?.message || 'Invalid token';
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

    // Parse cookies to extract tokens
    const cookies = req.headers.cookie ? cookie.parse(req.headers.cookie) : {};
    const authToken = cookies.authToken;
    const userId = cookies.userId ? parseInt(cookies.userId, 10) : NaN;

    console.log('[DEBUG] Cookies Parsed in Verify-Session:', { authToken, userId });

    if (!authToken || isNaN(userId)) {
      console.error('[ERROR] Missing or invalid cookies:', { authToken, userId });
      return res.status(401).json({
        error: 'Unauthorized: Missing or invalid authToken or userId',
        details: { authToken, userId },
      });
    }

    // Validate Facebook token
    console.log('[DEBUG] Sending request to Facebook for token validation');
    const tokenDetails = await validateFacebookToken(authToken);

    // Extract user details from token validation
    const user = {
      fb_id: tokenDetails.user_id,
      scopes: tokenDetails.scopes,
    };

    console.log('[DEBUG] Session verified successfully:', user);

    // Send success response
    return res.status(200).json({
      message: 'Session verified successfully',
      user,
    });
  } catch (error) {
    console.error('[ERROR] Unexpected error during session verification:', error.message);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
