// inbound-calls.js
import express from 'express';
import supabase from './supabaseClient.js';

const router = express.Router();

/**
 * Fetch all inbound calls for a specific business.
 * @route GET /inbound-calls/:businessId
 * @param {string} businessId - The ID of the business.
 */
router.get('/:businessId', async (req, res) => {
  const { businessId } = req.params;

  try {
    // Fetch call logs for the given business ID from Supabase
    const { data, error } = await supabase
      .from('inbound_calls')
      .select('*')
      .eq('business_id', businessId)
      .order('timestamp', { ascending: false }); // Sort by most recent

    if (error) {
      console.error('[ERROR] Failed to fetch inbound calls:', error.message);
      return res.status(500).json({ error: 'Failed to fetch inbound calls.' });
    }

    // Return the fetched data to the frontend
    return res.status(200).json(data);
  } catch (err) {
    console.error('[ERROR] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Unexpected error occurred.' });
  }
});

/**
 * Fetch a specific conversation by its ID.
 * @route GET /inbound-calls/conversation/:conversationId
 * @param {string} conversationId - The ID of the conversation.
 */
router.get('/conversation/:conversationId', async (req, res) => {
  const { conversationId } = req.params;

  try {
    // Fetch the conversation details by conversation ID
    const { data, error } = await supabase
      .from('inbound_calls')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('timestamp', { ascending: true }); // Sort messages chronologically

    if (error) {
      console.error('[ERROR] Failed to fetch conversation:', error.message);
      return res.status(500).json({ error: 'Failed to fetch conversation.' });
    }

    // Return the fetched conversation to the frontend
    return res.status(200).json(data);
  } catch (err) {
    console.error('[ERROR] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Unexpected error occurred.' });
  }
});

export default router;
