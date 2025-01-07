// File: auth/verify-session.js

import { refreshUserAccessToken } from './refresh-token.js';
import { validateFacebookToken } from '../helpers.js';
import supabase from '../supabaseClient.js';
import cookie from 'cookie';

export default async function handler(req, res) {
  try {
    console.log('[DEBUG] Incoming request to /auth/verify-session');

    // Only allow POST
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // 1) Parse cookies (we only need the authToken)
    const cookies = req.headers.cookie ? cookie.parse(req.headers.cookie) : {};
    const authToken = cookies.authToken || null;

    console.log('[DEBUG] Cookies Parsed in Verify-Session:', { authToken });

    if (!authToken) {
      console.error('[ERROR] Missing or invalid authToken');
      return res.status(401).json({
        error: 'Unauthorized: Missing or invalid authToken',
      });
    }

    // 2) Validate token with Facebook
    const tokenDetails = await validateFacebookToken(authToken);
    if (!tokenDetails.isValid) {
      console.warn('[WARN] Token expired or invalid. Attempting to refresh...');
      // If you rely on refreshing, you'd need the internal businessOwnerId or some logic
      // that can look up the user by their FB userId. For simplicity, let's just say:
      return res.status(401).json({ error: 'Token expired or invalid. Please log in again.' });
    }

    // 3) We have a valid FB token. tokenDetails.userId is the FB user ID (e.g. "10162270605008328").
    console.log('[DEBUG] Facebook user ID:', tokenDetails.userId);

    // 4) Look up the matching business_owner row by fb_id
    //    Because from your screenshot, "business_owners" includes "fb_id" and "business_id".
    const { data: ownerRecord, error: ownerError } = await supabase
      .from('business_owners')
      // NOTE: Adjust columns to match your actual structure. 
      // If you have "business_id" in the business_owners table, include it.
      .select('id, fb_id, name, email, business_id')
      .eq('fb_id', tokenDetails.userId)
      .single();

    if (ownerError || !ownerRecord) {
      console.error('[ERROR] No matching business_owner found for fb_id:', tokenDetails.userId);
      return res.status(404).json({
        error: 'Business owner not found.',
      });
    }

    // Now we have the real business_owner.id (your internal PK) and the business_id
    const realBusinessOwnerId = ownerRecord.id;
    const realBusinessId = ownerRecord.business_id; // if your table has "business_id"

    console.log('[DEBUG] Found businessOwner in DB:', {
      businessOwnerId: realBusinessOwnerId,
      businessId: realBusinessId,
    });

    // 5) (Optional) Refresh token if you store short-lived tokens in DB
    //    Suppose your refreshUserAccessToken requires realBusinessOwnerId
    //    const refreshedToken = await refreshUserAccessToken(realBusinessOwnerId, authToken);
    //    if (refreshedToken) {
    //      res.cookie('authToken', refreshedToken, { ... });
    //    }

    // 6) Return a response with the actual IDs from your DB
    //    This ensures the front end can call /retrieve-leads?businessOwnerId=xxx&businessId=yyy
    return res.status(200).json({
      message: 'Session verified successfully',
      businessOwnerId: realBusinessOwnerId,    // <--- your internal PK
      businessId: realBusinessId || null,      // <--- from business_owners.business_id
      // Additionally, we can return the FB user ID, name, email, etc. if needed
      businessOwner: {
        fb_id: ownerRecord.fb_id,
        name: ownerRecord.name,
        email: ownerRecord.email,
        scopes: tokenDetails.scopes, // from FB token debug
      },
    });
  } catch (error) {
    console.error('[ERROR] Unexpected error during session verification:', error.message);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
