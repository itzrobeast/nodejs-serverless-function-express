// inbound-calls.js
import express from 'express';
import supabase from './supabaseClient.js';

const router = express.Router();

/**
 * Get a specific conversation by its ID.
 * NOTE: This route MUST be defined before "/:businessId" to avoid route shadowing.
 * @route GET /inbound-calls/conversation/:conversationId
 */
router.get('/conversation/:conversationId', async (req, res) => {
  const { conversationId } = req.params;

  try {
    const { data, error } = await supabase
      .from('inbound_calls')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('timestamp', { ascending: true }); // messages chronologically

    if (error) {
      console.error('[ERROR] Failed to fetch conversation:', error.message);
      return res.status(500).json({ error: 'Failed to fetch conversation.' });
    }

    return res.status(200).json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error('[ERROR] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Unexpected error occurred.' });
  }
});

/**
 * Fetch inbound calls for a specific business.
 * Supports pagination and optional time window.
 * @route GET /inbound-calls/:businessId
 * @query limit (default 50), offset (default 0), since (ISO), until (ISO)
 */
router.get('/:businessId', async (req, res) => {
  const businessIdParam = req.params.businessId;
  // Cast to number to avoid string/number mismatch
  const businessId = Number(businessIdParam);
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const since = req.query.since; // ISO string
  const until = req.query.until; // ISO string

  if (!Number.isFinite(businessId)) {
    return res.status(400).json({ error: 'Invalid businessId' });
  }

  try {
    let q = supabase
      .from('inbound_calls')
      .select('*', { count: 'exact' })
      .eq('business_id', businessId)
      .order('timestamp', { ascending: false }) // newest first
      .range(offset, offset + limit - 1);

    // Optional time filtering (uses "timestamp" column; change if your schema differs)
    if (since) q = q.gte('timestamp', since);
    if (until) q = q.lte('timestamp', until);

    const { data, error, count } = await q;

    if (error) {
      console.error('[ERROR] Failed to fetch inbound calls:', error.message);
      return res.status(500).json({ error: 'Failed to fetch inbound calls.' });
    }

    return res.status(200).json({
      items: Array.isArray(data) ? data : [],
      total: typeof count === 'number' ? count : null,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[ERROR] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Unexpected error occurred.' });
  }
});

export default router;
