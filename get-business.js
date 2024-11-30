import express from 'express';
import supabase from './supabaseClient.js'; // Ensure the path is correct

const router = express.Router();

// GET /get-business
router.get('/', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId in query parameters' });
    }

    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', userId)
      .single();

    if (error) {
      console.error('[ERROR] Failed to fetch business data:', error.message);
      return res.status(500).json({ error: 'Failed to fetch business data', details: error.message });
    }

    res.status(200).json(data);
  } catch (err) {
    console.error('[ERROR] Unexpected error:', err.message);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// PUT /update-business
router.put('/', async (req, res) => {
  try {
    const { id, name, contact_email, locations, ai_knowledge } = req.body;

    if (!id || !name || !contact_email) {
      return res.status(400).json({ error: 'Missing required fields: id, name, or contact_email' });
    }

    const { data, error } = await supabase
      .from('businesses')
      .update({ name, contact_email, locations, ai_knowledge })
      .eq('id', id);

    if (error) {
      console.error('[ERROR] Failed to update business data:', error.message);
      return res.status(500).json({ error: 'Failed to update business data', details: error.message });
    }

    res.status(200).json({ message: 'Business information updated successfully', data });
  } catch (err) {
    console.error('[ERROR] Unexpected error:', err.message);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
