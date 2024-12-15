import express from 'express';
import supabase from './supabaseClient.js';

const router = express.Router();

/**
 * GET /vonage-number?userId=XYZ
 * Fetch the Vonage number from the vonage_numbers table by userId.
 */
router.get('/', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'Missing required parameter: userId' });
    }

    // Fetch the business row using userId. 
    // Change .eq('user_id', userId) to .eq('owner_id', userId) ONLY IF
    // your DB actually stores the user’s ID in a column named 'owner_id'.
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id')
      .eq('user_id', userId)    // <-- If your table uses "owner_id", swap this to .eq('owner_id', userId).
      .single();

    if (businessError || !business) {
      console.error('[ERROR] Failed to fetch business:', businessError?.message || 'No business found');
      return res.status(404).json({ error: 'No business found for the provided userId' });
    }

    const business_id = business.id;

    // Fetch Vonage number from vonage_numbers by the matching business_id
    const { data: vonage, error: vonageError } = await supabase
      .from('vonage_numbers')
      .select('vonage_number')
      .eq('business_id', business_id)
      .single();

    if (vonageError || !vonage) {
      console.error('[ERROR] Failed to fetch Vonage number:', vonageError?.message || 'No Vonage number found');
      return res.status(404).json({ error: 'No Vonage number found for the business' });
    }

    return res.status(200).json({ vonage_number: vonage.vonage_number });
  } catch (error) {
    console.error('[ERROR] Internal server error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
