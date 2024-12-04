import express from 'express';
import supabase from './supabaseClient.js';

const router = express.Router();

// GET Handler to fetch the business phone number
router.get('/', async (req, res) => {
  try {
    const { business_id } = req.query;

    if (!business_id) {
      return res.status(400).json({ error: 'Missing required parameter: business_id' });
    }

    const { data, error } = await supabase
      .from('vonage_numbers')
      .select('vonage_number')
      .eq('business_id', business_id)
      .single();

    if (error) {
      console.error('[ERROR] Failed to fetch Vonage number:', error.message);
      return res.status(500).json({ error: 'Failed to retrieve Vonage number' });
    }

    if (!data) {
      return res.status(404).json({ error: 'No Vonage number found for this business' });
    }

    res.status(200).json({ vonage_number: data.vonage_number });
  } catch (error) {
    console.error('[ERROR] Internal server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
