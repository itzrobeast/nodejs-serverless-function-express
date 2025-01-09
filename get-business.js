import express from 'express';
import supabase from './supabaseClient.js';

const router = express.Router();

/**
 * Fetch business data for the authenticated user.
 * GET /get-business
 */
router.get('/', async (req, res) => {
  try {
    const business_owner_id = req.cookies.businessOwnerId
      ? parseInt(req.cookies.businessOwnerId, 10)
      : null;

    console.log('[DEBUG] Received cookies:', req.cookies);

    if (!business_owner_id) {
      console.error('[ERROR] Missing businessOwnerId in cookies.');
      return res.status(401).json({ error: 'Unauthorized: Please log in again.' });
    }

    // Query the database for the business data
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('business_owner_id', business_owner_id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Business not found' });
      }
      throw new Error(error.message);
    }

    if (!data) {
      return res.status(404).json({ error: 'No business found for the provided user ID' });
    }

    console.log('[DEBUG] Business data fetched successfully:', data);
    res.status(200).json(data);
  } catch (err) {
    console.error('[ERROR] Unexpected error in GET /get-business:', err.message);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});



/**
 * Update business data for the authenticated user.
 * PUT /get-business/update-business
 */
router.put('/update-business', async (req, res) => {
  try {
    const business_owner_id = req.cookies.businessOwnerId
      ? parseInt(req.cookies.businessOwnerId, 10)
      : null;

    console.log('[DEBUG] Received cookies:', req.cookies);

    if (!business_owner_id) {
      console.error('[ERROR] Missing businessOwnerId in cookies.');
      return res.status(401).json({ error: 'Unauthorized: Please log in again.' });
    }

    const { name, address, phone } = req.body;

    if (!name || !address || !phone) {
      console.error('[ERROR] Missing required fields in request body.');
      return res.status(400).json({ error: 'Missing required fields: name, address, phone' });
    }

    // Update the database with the new business information
    const { data, error } = await supabase
      .from('businesses')
      .update({ name, address, phone })
      .eq('business_owner_id', business_owner_id)
      .single();

    if (error) {
      throw new Error(error.message);
    }

    console.log('[DEBUG] Business data updated successfully:', data);
    res.status(200).json({ message: 'Business updated successfully', data });
  } catch (err) {
    console.error('[ERROR] Unexpected error in PUT /get-business/update-business:', err.message);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});



export default router;
