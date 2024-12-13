import express from 'express';
import supabase from './supabaseClient.js';
import { validateBusiness } from './middleware/validation.js';

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

    if (error && error.code === 'PGRST116') {
      return res.status(404).json({ error: 'Business not found' });
    } else if (error) {
      throw error;
    }

    res.status(200).json(data);
  } catch (err) {
    console.error('[ERROR] Unexpected error:', err.message);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// POST /add-or-update-business
router.post('/', validateBusiness, async (req, res) => {
  try {
    const fields = req.body;
    const { owner_id } = fields;

    const { data, isNew } = await updateOrCreateBusiness(owner_id, fields);
    res.status(isNew ? 201 : 200).json({
      message: isNew
        ? 'Business information added successfully'
        : 'Business information updated successfully',
      data,
    });
  } catch (err) {
    console.error('[ERROR] Failed to process business:', err.message);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
