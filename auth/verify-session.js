import express from 'express';
import jwt from 'jsonwebtoken';
import supabase from '../supabaseClient.js';

const router = express.Router();

/**
 * GET /verify-session
 * Endpoint to verify user session and fetch business data.
 */
router.get('/', async (req, res) => {
  try {
    console.log('[DEBUG] Incoming request:', req.url);

    // Validate the Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('[ERROR] Missing or malformed Authorization header');
      return res.status(400).json({ error: 'Missing or malformed Authorization header' });
    }

    // Extract and verify the JWT
    const token = authHeader.split(' ')[1];
    console.log('[DEBUG] Raw token:', token);
    let user;
    try {
      user = jwt.verify(token, process.env.MILA_SECRET);
    } catch (jwtError) {
      console.error('[ERROR] Invalid token:', jwtError.message);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    console.log('[DEBUG] Token successfully verified:', user);

    // Validate the business_id query parameter
    const businessId = req.query.business_id;
    if (!businessId) {
      console.error('[ERROR] Missing required parameter: business_id');
      return res.status(400).json({ error: 'Missing required parameter: business_id' });
    }
    console.log('[DEBUG] Provided business ID:', businessId);

    // Fetch the business data from the Supabase database
    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', businessId) // Ensure we're querying the "id" field, not "business-id"
      .single();

    if (businessError || !businessData) {
      console.error('[ERROR] Business not found:', businessError?.message);
      return res.status(404).json({ error: 'Business not found' });
    }
    console.log('[DEBUG] Business data retrieved:', businessData);

    // Respond with session and business data
    return res.status(200).json({
      message: 'Session verified successfully',
      user,
      business: businessData,
    });
  } catch (error) {
    console.error('[ERROR] Unexpected error in /verify-session:', error.message);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

export default router;
