import jwt from 'jsonwebtoken';
import supabase from '../supabaseClient.js';
import cookie from 'cookie';

// Ensure MILA_SECRET is defined
if (!process.env.MILA_SECRET) {
  throw new Error('[CRITICAL] MILA_SECRET is not defined in environment variables');
}

export default async function handler(req, res) {
  try {
    console.log('[DEBUG] Incoming request to /auth/verify-session');

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Parse cookies
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

    // Verify the JWT token
    let user;
    try {
      user = jwt.verify(token, process.env.MILA_SECRET);
    } catch (error) {
      console.error('[ERROR] Invalid or expired token:', error.message);
      return res.status(401).json({
        error: error.name === 'TokenExpiredError'
          ? 'Token expired. Please log in again.'
          : 'Invalid token. Please log in again.',
      });
    }

    console.log('[DEBUG] Token verified. User:', user);

    // Validate business_id if provided
    const businessId = req.query.business_id;
    if (businessId) {
      const { data: businessData, error: businessError } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', businessId)
        .eq('owner_id', user.fb_id) // Ensure the user owns the business
        .single();

      if (businessError || !businessData) {
        console.error('[ERROR] Business not found or unauthorized:', businessError?.message);
        return res.status(404).json({ error: 'Business not found or unauthorized access' });
      }

      console.log('[DEBUG] Business data retrieved:', businessData);
      return res.status(200).json({
        message: 'Session verified successfully',
        user,
        business: businessData,
      });
    }

    // Respond with user data if no business ID is provided
    return res.status(200).json({
      message: 'Session verified successfully',
      user,
    });
  } catch (error) {
    console.error('[ERROR] Unexpected error:', error.message);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
