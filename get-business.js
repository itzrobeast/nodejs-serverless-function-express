import express from 'express';
import supabase from './supabaseClient.js';

const router = express.Router();

/**
 * Fetch business data for a specific user.
 * GET /get-business?user_id=XYZ
 */
router.get('/', async (req, res) => {
  try {
    const user_id = parseInt(req.query.user_id, 10); // Ensure `user_id` is an integer
    if (isNaN(user_id)) {
      console.error('[ERROR] Invalid or missing user_id in query params:', req.query.user_id);
      return res.status(400).json({ error: 'Invalid or missing user_id in query parameters' });
    }

    console.log(`[DEBUG] Fetching business data for user_id: ${user_id}`);
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('user_id', user_id)
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

/**
 * Update existing business data.
 * PUT /get-business/update-business
 */
router.put('/update-business', async (req, res) => {
  try {
    const user_id = parseInt(req.body.user_id, 10);
    if (isNaN(user_id)) {
      console.error('[ERROR] Invalid or missing user_id in request body:', req.body.user_id);
      return res.status(400).json({ error: 'Invalid or missing user_id in request body' });
    }

    const {
      name,
      contact_email,
      locations,
      insurance_policies,
      objections,
      ai_knowledge_base,
      page_id,
      access_token,
      vonage_number,
    } = req.body;

    if (!name || !contact_email) {
      console.error('[ERROR] Missing required fields: name or contact_email');
      return res.status(400).json({ error: 'Missing required fields: name or contact_email' });
    }

    // Ensure these fields match your DB column names
    const updateFields = {
      name,
      contact_email,
      locations: locations || '',
      insurance_policies: insurance_policies || '',
      objections: objections || '',
      ai_knowledge_base: ai_knowledge_base || '',
      page_id: page_id || null,
      access_token: access_token || null,
      
    };

    console.log(`[DEBUG] Updating business for user_id: ${user_id}`, updateFields);
    const { data, error } = await supabase
      .from('businesses')
      .update(updateFields)
      .eq('user_id', user_id)
      .select('*');

    if (error) {
      console.error('[ERROR] Failed to update business data:', error.message);
      return res.status(500).json({ error: 'Failed to update business data', details: error.message });
    }

    console.log('[DEBUG] Business updated successfully:', data);
    return res.status(200).json({ message: 'Business information updated successfully', data });
  } catch (err) {
    console.error('[ERROR] Unexpected error in PUT /update-business:', err.message);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

/**
 * Add or update a business for a user.
 * POST /get-business/add-or-update-business
 */
router.post('/add-or-update-business', async (req, res) => {
  try {
    const user_id = parseInt(req.body.user_id, 10);
    if (isNaN(user_id)) {
      console.error('[ERROR] Invalid or missing user_id in request body:', req.body.user_id);
      return res.status(400).json({ error: 'Invalid or missing user_id in request body' });
    }

    const {
      name,
      contact_email,
      locations,
      insurance_policies,
      objections,
      ai_knowledge_base,
      page_id,
      access_token,
      vonage_number,
    } = req.body;

    if (!name || !contact_email) {
      console.error('[ERROR] Missing required fields: name or contact_email');
      return res.status(400).json({ error: 'Missing required fields: name or contact_email' });
    }

    console.log(`[DEBUG] Processing business data for user_id: ${user_id}`);
    const { data: existingBusiness, error: fetchError } = await supabase
      .from('businesses')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('[ERROR] Failed to fetch existing business data:', fetchError.message);
      return res.status(500).json({ error: 'Failed to fetch existing business data', details: fetchError.message });
    }

    if (existingBusiness) {
      console.log(`[DEBUG] Business exists for user_id: ${user_id}. Updating data.`);
      const updateFields = {
        name,
        contact_email,
        locations: locations || '',
        insurance_policies: insurance_policies || '',
        objections: objections || '',
        ai_knowledge_base: ai_knowledge_base || '',
        page_id: page_id || null,
        access_token: access_token || null,
        vonage_number: vonage_number || null,
      };

      const { data, error } = await supabase
        .from('businesses')
        .update(updateFields)
        .eq('id', existingBusiness.id)
        .select('*');

      if (error) {
        console.error('[ERROR] Failed to update business data:', error.message);
        return res.status(500).json({ error: 'Failed to update business data', details: error.message });
      }

      console.log('[DEBUG] Business updated successfully:', data);
      return res.status(200).json({ message: 'Business information updated successfully', data });
    } else {
      console.log(`[DEBUG] No business found for user_id: ${user_id}. Adding new business.`);
      const { data, error: insertError } = await supabase
        .from('businesses')
        .insert([
          {
            user_id,
            name,
            contact_email,
            locations: locations || '',
            insurance_policies: insurance_policies || '',
            objections: objections || '',
            ai_knowledge_base: ai_knowledge_base || '',
            page_id: page_id || null,
            access_token: access_token || null,
            vonage_number: vonage_number || null,
          },
        ])
        .select('*');

      if (insertError) {
        console.error('[ERROR] Failed to insert business data:', insertError.message);
        return res.status(500).json({ error: 'Failed to insert business data', details: insertError.message });
      }

      console.log('[DEBUG] Business added successfully:', data);
      return res.status(201).json({ message: 'Business information added successfully', data });
    }
  } catch (err) {
    console.error('[ERROR] Unexpected error in POST /add-or-update-business:', err.message);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
