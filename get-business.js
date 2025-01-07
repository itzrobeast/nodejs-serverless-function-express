import express from 'express';
import supabase from './supabaseClient.js';

const router = express.Router();

/**
 * Fetch business data for the authenticated user.
 * GET /get-business
 */
router.get('/', async (req, res) => {
  try {
    // Step 1: Parse and validate cookies
    const business_owner_id = req.cookies.businessOwnerId
      ? parseInt(req.cookies.businessOwnerId, 10)
      : null;
    console.log('[DEBUG] Received cookies:', req.cookies);

    if (!business_owner_id) {
      console.error('[ERROR] Invalid or missing businessOwnerId in cookies:', req.cookies.businessOwnerId);
      return res.status(401).json({
        error: 'Unauthorized: Please log in again to access this resource.',
        details: 'Missing or invalid businessOwnerId in cookies.',
      });
    }

    console.log('[DEBUG] Parsed businessOwnerId:', business_owner_id);

    // Step 2: Query the database for the business data
    console.log(`[DEBUG] Making database query with business_owner_id: ${business_owner_id}`);
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

    if (!data) {
      console.warn('[WARN] No business data found for business_owner_id:', business_owner_id);
      return res.status(404).json({ error: 'Business not found for this user' });
    }

    // Debug log the retrieved data structure
    console.log('[DEBUG] Retrieved business data structure:', data);

    // Return the fetched data
    console.log('[DEBUG] Business data fetched successfully:', data);
    return res.status(200).json(data);
  } catch (err) {
    // Catch and handle unexpected errors
    console.error('[ERROR] Unexpected error in GET /get-business:', err.message);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// Debug log indicating that the route was initialized
console.log('[INFO] GET /get-business route initialized');

export default router;
