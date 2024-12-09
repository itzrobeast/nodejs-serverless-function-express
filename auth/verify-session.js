import express from 'express';
import jwt from 'jsonwebtoken';
import supabase from '../supabaseClient.js';

const router = express.Router();

// GET /verify-session
router.get('/', async (req, res) => {
  try {
    console.log('[DEBUG] Request received:', req.url);

    // Validate Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('[ERROR] Missing or malformed Authorization header');
      return res.status(400).json({ error: 'Missing or malformed Authorization header' });
    }

    // Extract and verify the token
    const token = authHeader.split(' ')[1];
    const user = jwt.verify(token, process.env.MILA_SECRET);
    console.log('[DEBUG] Token verified:', user);

    // Check for the business_id query parameter
    const businessId = req.query.business_id;
    if (!businessId) {
      console.error('[ERROR] Missing required parameter: business_id');
      return res.status(400).json({ error: 'Missing required parameter: business_id' });
    }
    console.log('[DEBUG] Business ID:', businessId);

    // Fetch the business data from the Supabase database
    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', businessId) // Corrected the variable name here
      .single();

    if (businessError || !businessData) {
      console.error('[ERROR] Business not found:', businessError?.message);
      return res.status(404).json({ error: 'Business not found' });
    }

    console.log('[DEBUG] Business fetched:', businessData);

    // Return a successful response with user and business data
    return res.status(200).json({
      message: 'Session verified successfully',
      user,
      business: businessData,
    });
  } catch (error) {
    console.error('[ERROR] Internal error in /verify-session:', error.message);
    return res.status(500).json({ error: 'Internal server error.', details: error.message });
  }
});

export default router;
