// outbound-settings.js
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// GET /outbound-settings?business_id=3
router.get('/', async (req, res) => {
  try {
    const business_id = String(req.query.business_id || '').trim();
    if (!business_id) return res.status(400).json({ error: 'business_id required' });

    const { data: business, error: bErr } = await supabase
      .from('businesses')
      .select('id,outbound_calls_enabled,outbound_test_mode')
      .eq('id', business_id)
      .single();
    if (bErr) return res.status(500).json({ error: bErr.message });

    const { data: policy, error: pErr } = await supabase
      .from('outbound_policies')
      .select('timezone,daily_call_cap,quiet_hours,dnc_list')
      .eq('business_id', business_id)
      .maybeSingle();

    if (pErr) {
      console.warn('[WARN] /outbound-settings policy fetch:', pErr.message);
      return res.status(200).json({ business, policy: null, warning: pErr.message });
    }

    return res.status(200).json({ business, policy });
  } catch (err) {
    console.error('[GET /outbound-settings]', err);
    res.status(500).json({ error: 'Internal error', detail: String(err?.message || err) });
  }
});

// POST /outbound-settings
router.post('/', async (req, res) => {
  try {
    const { business_id, outbound_calls_enabled, outbound_test_mode, policy } = req.body || {};
    if (!business_id) return res.status(400).json({ error: 'business_id required' });

    const { error: upBizErr } = await supabase
      .from('businesses')
      .update({
        outbound_calls_enabled: !!outbound_calls_enabled,
        outbound_test_mode: !!outbound_test_mode,
      })
      .eq('id', business_id);
    if (upBizErr) return res.status(500).json({ error: upBizErr.message });

    if (policy) {
      const record = {
        business_id,
        timezone: policy.timezone || 'America/Los_Angeles',
        daily_call_cap: Number(policy.daily_call_cap ?? 0),
        quiet_hours: policy.quiet_hours || null, // {start:"HH:MM", end:"HH:MM"} or null
        dnc_list: Array.isArray(policy.dnc_list) ? policy.dnc_list : [],
      };
      const { error: upPolErr } = await supabase
        .from('outbound_policies')
        .upsert(record, { onConflict: 'business_id' });
      if (upPolErr) return res.status(500).json({ error: upPolErr.message });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[POST /outbound-settings]', err);
    res.status(500).json({ error: 'Internal error', detail: String(err?.message || err) });
  }
});

export default router;
