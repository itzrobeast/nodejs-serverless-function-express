import express from 'express';
import jwt from 'jsonwebtoken';
import supabase from './supabaseClient.js';

const router = express.Router();

router.get('/verify-session', async (req, res) => {
  try {
    console.log('[DEBUG] Request received:', req.url, req.query);

    // Step 1: Validate Authorization header
    const authHeader = req.headers.authorization;
    console.log('[DEBUG] Authorization header:', authHeader);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('[ERROR] Missing or malformed Authorization header');
      return res.status(400).json({ error: 'Missing or malformed Authorization header' });
    }

    // Step 2: Verify JWT token
    const token = authHeader.split(' ')[1];
    let user;
    try {
      user = jwt.verify(token, process.env.MILA_SECRET);
    } catch (err) {
      console.error('[ERROR] Token verification failed:', err.message);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    console.log('[DEBUG] Token verified:', user);

    // Step 3: Validate business_id query parameter
    const businessId = req.query.business_id;
    console.log('[DEBUG] business_id:', businessId);

    if (!businessId) {
      console.error('[ERROR] Missing required parameter: business_id');
      return res.status(400).json({ error: 'Missing required parameter: business_id' });
    }

    // Step 4: Fetch business data from the database
    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', businessId)
      .single();

    if (businessError || !businessData) {
      console.error('[ERROR] Business not found or Supabase error:', businessError?.message);
      return res.status(404).json({ error: 'Business not found' });
    }

    console.log('[DEBUG] Business fetched:', businessData);

    // Step 5: Validate page ID and access token
    const { page_id: pageId, access_token: accessToken } = businessData;

    if (!pageId || !accessToken) {
      console.error('[ERROR] Missing Page ID or Access Token');
      return res.status(400).json({ error: 'Page ID or Access Token missing.' });
    }

    console.log('[DEBUG] pageId:', pageId);
    console.log('[DEBUG] accessToken:', accessToken);

    // Step 6: Return success response
    return res.status(200).json({ user, business: businessData });
  } catch (error) {
    console.error('[ERROR] Internal error in /verify-session:', error.message);
    return res.status(500).json({ error: 'Internal server error.', details: error.message });
  }
});

export default router;
