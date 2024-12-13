import express from 'express';
import supabase from './supabaseClient.js';

const router = express.Router();

// GET /get-business
router.get('/', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId in query parameters' });
    }

    console.log(`[DEBUG] Fetching business data for userId: ${userId}`);

    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Business not found' });
      }
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
  console.log('[DEBUG] Incoming request to update business:', req.body);
  try {
    const {
      owner_id,
      name,
      contact_email,
      locations,
      insurance_policies,
      objections,
      ai_knowledge_base,
      page_id,
      access_token,
    } = req.body;

    if (!owner_id || !name || !contact_email) {
      return res.status(400).json({ error: 'Missing required fields: id, name, or contact_email' });
    }

    const updateFields = {
      name,
      contact_email,
      locations: locations || [],
      insurance_policies: insurance_policies || {},
      objections: objections || {},
      ai_knowledge_base: ai_knowledge_base || '',
      page_id: page_id || null,
      access_token: access_token || null,
    };

    console.log(`[DEBUG] Updating business for owner_id: ${owner_id}`, updateFields);

    const { data, error } = await supabase
      .from('businesses')
      .update(updateFields)
      .eq('owner_id', owner_id);

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

// POST /add-or-update-business
router.post('/', async (req, res) => {
  console.log('[DEBUG] Incoming request to add or update business:', req.body);
  try {
    const {
      owner_id,
      name,
      contact_email,
      locations,
      insurance_policies,
      objections,
      ai_knowledge_base,
      page_id,
      access_token,
    } = req.body;

    if (!owner_id || !name || !contact_email) {
      return res.status(400).json({
        error: 'Missing required fields: owner_id, name, or contact_email',
      });
    }

    const { data: existingBusiness, error: fetchError } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', owner_id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('[ERROR] Failed to fetch existing business data:', fetchError.message);
      return res.status(500).json({ error: 'Failed to fetch existing business data', details: fetchError.message });
    }

    if (existingBusiness) {
      console.log(`[DEBUG] Business exists for owner_id: ${owner_id}. Updating data.`);
      const updateFields = {
        name,
        contact_email,
        locations: locations || [],
        insurance_policies: insurance_policies || {},
        objections: objections || {},
        ai_knowledge_base: ai_knowledge_base || '',
        page_id: page_id || null,
        access_token: access_token || null,
      };

      const { data, error } = await supabase
        .from('businesses')
        .update(updateFields)
        .eq('id', existingBusiness.id);

      if (error) {
        console.error('[ERROR] Failed to update business data:', error.message);
        return res.status(500).json({ error: 'Failed to update business data', details: error.message });
      }

      return res.status(200).json({ message: 'Business information updated successfully', data });
    } else {
      console.log(`[DEBUG] No business found for owner_id: ${owner_id}. Adding new business.`);
      const { data, error: insertError } = await supabase.from('businesses').insert([
        {
          owner_id,
          name,
          contact_email,
          locations: locations || [],
          insurance_policies: insurance_policies || {},
          objections: objections || {},
          ai_knowledge_base: ai_knowledge_base || '',
          page_id: page_id || null,
          access_token: access_token || null,
        },
      ]);

      if (insertError) {
        console.error('[ERROR] Failed to insert business data:', insertError.message);
        return res.status(500).json({ error: 'Failed to insert business data', details: insertError.message });
      }

      return res.status(201).json({ message: 'Business information added successfully', data });
    }
  } catch (err) {
    console.error('[ERROR] Unexpected error:', err.message);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
