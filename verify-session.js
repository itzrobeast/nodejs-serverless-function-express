import express from 'express';
import jwt from 'jsonwebtoken';
import supabase from './supabaseClient.js';

const router = express.Router();

router.get('/verify-session', async (req, res) => {
  try {
    console.log('[DEBUG] Request received:', req.url, req.query);

    // Step 1: Log all headers for debugging
    console.log('[DEBUG] Incoming headers:', req.headers);

    // Step 2: Validate Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('[ERROR] Missing or malformed Authorization header');
      return res.status(400).json({ error: 'Missing or malformed Authorization header' });
    }
    const token = authHeader.split(' ')[1];
    console.log('[DEBUG] Token received:', token);

    // Step 3: Verify JWT token
    let user;
    try {
      user = jwt.verify(token, process.env.MILA_SECRET);
      console.log('[DEBUG] Token verified successfully:', user);
    } catch (err) {
      console.error('[ERROR] Invalid token:', err.message);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Step 4: Validate business_id query parameter
    const businessId = req.query.business_id;
    if (!businessId) {
      console.error('[ERROR] Missing business_id query parameter');
      return res.status(400).json({ error: 'Missing business_id query parameter' });
    }
    console.log('[DEBUG] business_id received:', businessId);

    // Step 5: Fetch business data from Supabase
    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', businessId)
      .single();

    if (businessError || !businessData) {
      console.error('[ERROR] Business fetch failed:', businessError?.message);
      return res.status(404).json({ error: 'Business not found' });
    }
    console.log('[DEBUG] Business data:', businessData);

    // Step 6: Return success response
    return res.status(200).json({ user, business: businessData });
  } catch (error) {
    console.error('[ERROR] Internal error in /verify-session:', error.message);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

export default router;
