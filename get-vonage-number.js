import express from 'express';
import supabase from './supabaseClient.js';

const router = express.Router();

/**
 * GET /vonage-number?business_id=123
 * or GET /vonage-number?userId=456
 * 
 * If business_id is provided, we skip the fetch-by-user step.
 * If userId is provided (and no business_id), we fetch the matching business row first.
 */
router.get('/', async (req, res) => {
  try {
    let { business_id, userId } = req.query;

    // Convert numeric strings to actual numbers
    if (business_id) business_id = parseInt(business_id, 10);
    if (userId) userId = parseInt(userId, 10);

    // If front-end directly supplies business_id, skip the userId logic
    if (!business_id && !userId) {
      return res.status(400).json({ error: 'Missing required parameter: business_id or userId' });
    }

    if (!business_id && userId) {
      // We only have userId, so fetch the business to get its ID
      const { data: business, error: businessError } = await supabase
        .from('businesses')
        .select('id')
        .eq('business_owner_id', ownerId) 
        .single();

      if (businessError || !business) {
        console.error('[ERROR] Failed to fetch business from userId:', businessError?.message || 'No business found');
        return res.status(404).json({ error: 'No business found for the provided userId' });
      }
      business_id = business.id;
    }

    // Now we definitely have a business_id
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
