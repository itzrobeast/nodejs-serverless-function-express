import { refreshUserAccessToken } from './refresh-token.js';
import { validateFacebookToken } from './helpers.js';
import cookie from 'cookie';

export default async function handler(req, res) {
  try {
    console.log('[DEBUG] Incoming request to /auth/verify-session');

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Parse cookies to extract tokens
    const cookies = req.headers.cookie ? cookie.parse(req.headers.cookie) : {};
    const authToken = cookies.authToken;
    const businessOwnerId = cookies.businessOwnerId ? parseInt(cookies.businessOwnerId, 10) : NaN;

    console.log('[DEBUG] Cookies Parsed in Verify-Session:', { authToken, businessOwnerId });

    if (!authToken || isNaN(businessOwnerId)) {
      console.error('[ERROR] Missing or invalid cookies:', { authToken, businessOwnerId });
      return res.status(401).json({
        error: 'Unauthorized: Missing or invalid authToken or businessOwnerId',
        details: { authToken, businessOwnerId },
      });
    }

    // Validate token
    const tokenDetails = await validateFacebookToken(authToken);
    if (!tokenDetails.isValid) {
      console.warn('[WARN] Token expired or invalid. Attempting to refresh...');
      const refreshedToken = await refreshUserAccessToken(businessOwnerId, authToken);
      if (!refreshedToken) {
        console.error('[ERROR] Failed to refresh token for businessOwnerId:', businessOwnerId);
        return res.status(401).json({
          error: 'Unauthorized: Token expired and could not be refreshed.',
        });
      }

      console.log('[INFO] Token refreshed successfully:', refreshedToken);
      res.cookie('authToken', refreshedToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'None',
        maxAge: 3600000, // 1 hour
      });
      return res.status(200).json({
        message: 'Session verified and token refreshed successfully',
        businessOwner: { fb_id: tokenDetails.userId, scopes: tokenDetails.scopes },
      });
    }

    console.log('[DEBUG] Session verified successfully:', tokenDetails);
    return res.status(200).json({
      message: 'Session verified successfully',
      businessOwner: { fb_id: tokenDetails.userId, scopes: tokenDetails.scopes },
    });
  } catch (error) {
    console.error('[ERROR] Unexpected error during session verification:', error.message);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
