// backend/get-business.js

import express from 'express';
import supabase from './supabaseClient.js';

const router = express.Router();

/**
 * Fetch business data for the authenticated user.
 * GET /get-business
 */
router.get('/', async (req, res) => {
  try {
    const business_owner_id = parseInt(req.cookies.businessOwnerId, 10); // Read from cookies
    if (isNaN(business_owner_id)) {
      console.error('[ERROR] Invalid or missing businessOwnerId in cookies:', req.cookies.businessOwnerId);
      return res.status(400).json({ error: 'Invalid or missing businessOwnerId in cookies' });
    }

    console.log(`[DEBUG] Fetching business data for business_owner_id: ${business_owner_id}`);
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('business_owner_id', business_owner_id)
      .single();

    if (error) {
      console.error('[ERROR] Failed to fetch business data:', error.message);
      return error.code === 'PGRST116'
        ? res.status(404).json({ error: 'Business not found' })
        : res.status(500).json({ error: 'Failed to fetch business data', details: error.message });
    }

    console.log('[DEBUG] Business data fetched successfully:', data);
    return res.status(200).json(data);
  } catch (err) {
    console.error('[ERROR] Unexpected error in GET /get-business:', err.message);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
