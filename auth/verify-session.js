// Revised verify-session (basic example):
// 1) Validate FB token
// 2) supabase query business_owners by fb_id
// 3) return the row’s id (businessOwnerId) & business_id as businessId

import { refreshUserAccessToken } from './refresh-token.js';
import { validateFacebookToken } from '../helpers.js';
import supabase from '../supabaseClient.js';
import cookie from 'cookie';

export default async function handler(req, res) {
  try {
    console.log('[DEBUG] Incoming request to /auth/verify-session');

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const cookies = req.headers.cookie ? cookie.parse(req.headers.cookie) : {};
    const authToken = cookies.authToken;
    if (!authToken) {
      return res.status(401).json({
        error: 'Missing or invalid authToken cookie',
      });
    }

    // Validate with Facebook
    const tokenDetails = await validateFacebookToken(authToken);
    if (!tokenDetails.isValid) {
      // Attempt refresh or return 401
      return res.status(401).json({ error: 'FB token invalid or expired' });
    }

    // This is the FB user ID
    const fbId = tokenDetails.userId;
    console.log('[DEBUG] Verified FB user ID:', fbId);

    // Find the business owner row by fb_id
    const { data: ownerData, error: ownerErr } = await supabase
      .from('business_owners')
      .select('id, fb_id, business_id, name, email')
      .eq('fb_id', fbId)
      .single();

    if (ownerErr || !ownerData) {
      console.error('[ERROR] No matching business_owners row for fb_id:', fbId);
      return res.status(404).json({ error: 'Business owner not found' });
    }

    // For example: ownerData might be { id: 7, fb_id: '10162270605008328', business_id: 3, ... }
    const realBusinessOwnerId = ownerData.id;
    const realBusinessId = ownerData.business_id;

    // (Optional) Refresh token logic if needed
    // e.g. const refreshedToken = await refreshUserAccessToken(realBusinessOwnerId, authToken);

    // Return the real data
    return res.status(200).json({
      message: 'Session verified successfully',
      businessOwnerId: realBusinessOwnerId,
      businessId: realBusinessId || null,
      businessOwner: {
        fb_id: ownerData.fb_id,
        name: ownerData.name,
        email: ownerData.email,
        scopes: tokenDetails.scopes,
      },
    });
  } catch (error) {
    console.error('[ERROR] Unexpected error:', error.message);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
