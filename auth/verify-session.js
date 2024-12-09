import express from 'express';
import jwt from 'jsonwebtoken';
import supabase from '../supabaseClient.js';

const router = express.Router();

/**
 * GET /auth/verify-session
 * Verifies user session and optionally fetches business data.
 */
router.get('/', async (req, res) => {
  try {
    console.log('[DEBUG] Incoming request to /auth/verify-session:', req.url);

    // Token from cookie
    let token = req.cookies.authToken;

    // Token from Authorization header (if cookie is not used)
    if (!token && req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
    }

    if (!token) {
      console.error('[ERROR] Missing token in cookies or Authorization header');
      return res.status(401).json({ error: 'Unauthorized: Token not found' });
    }

    // Verify the token
    let user;
    try {
      user = jwt.verify(token, process.env.MILA_SECRET);
    } catch (jwtError) {
      console.error('[ERROR] Invalid or expired token:', jwtError.message);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    console.log('[DEBUG] Token successfully verified:', user);

    // Optional: Validate business_id if provided
    const businessId = req.query.business_id;
    if (businessId) {
      console.log('[DEBUG] Validating business ID:', businessId);

      const { data: businessData, error: businessError } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', businessId)
        .eq('owner_id', user.fb_id)
        .single();

      if (businessError || !businessData) {
        console.error('[ERROR] Business not found or unauthorized access:', businessError?.message);
        return res.status(404).json({ error: 'Business not found or unauthorized access' });
      }

      console.log('[DEBUG] Business data retrieved:', businessData);

      // Respond with user and business data
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
    console.error('[ERROR] Unexpected error in /auth/verify-session:', error.message);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

export default router;
