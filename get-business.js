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
    const business_owner_id = parseInt(req.cookies.businessOwnerId, 10); // Read from cookies
    console.log('[DEBUG] Received cookies:', req.cookies);

    if (isNaN(business_owner_id)) {
      console.error('[ERROR] Invalid or missing businessOwnerId in cookies:', req.cookies.businessOwnerId);
      return res.status(401).json({ 
        error: 'Unauthorized: Please log in again to access this resource.', 
        details: 'Missing or invalid businessOwnerId in cookies.' 
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

    // Step 3: Handle database query errors
    if (error) {
      console.error('[ERROR] Failed to fetch business data:', error.message);
      return error.code === 'PGRST116'
        ? res.status(404).json({ error: 'Business not found' })
        : res.status(500).json({ error: 'Failed to fetch business data', details: error.message });
    }

    // Step 4: Debug log the retrieved data structure
    console.log('[DEBUG] Retrieved business data structure:', data);

    // Step 5: Return the fetched data
    console.log('[DEBUG] Business data fetched successfully:', data);
    return res.status(200).json(data);
  } catch (err) {
    // Step 6: Catch and handle unexpected errors
    console.error('[ERROR] Unexpected error in GET /get-business:', err.message);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// Debug log indicating that the route was initialized
console.log('[INFO] GET /get-business route initialized');

export default router;
