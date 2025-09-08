// outbound-settings.js
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

router.get('/', async (req, res) => {
  try {
    const business_id = req.query.business_id;
    if (!business_id) return res.status(400).json({ error: 'business_id required' });

    + const { data: business, error: bErr } = await supabase
+   .from('businesses')
+   .select('id,outbound_calls_enabled,outbound_test_mode')
      .eq('id', business_id)
      .single();
    if (bErr) return res.status(500).json({ error: bErr.message });

    const { data: policy, error: pErr } = await supabase
      .from('outbound_policies')
      .select('timezone,daily_call_cap,quiet_hours,dnc_list')
      .eq('business_id', business_id)
      .maybeSingle();

    if (pErr) return res.status(200).json({ business, policy: null, warning: pErr.message });
    return res.status(200).json({ business, policy });
  } catch (err) {
    console.error('[GET /outbound-settings]', err);
    res.status(500).json({ error: 'Internal error', detail: String(err?.message || err) });
  }
});

router.post('/', express.json(), async (req, res) => {
  try {
    const { business_id, outbound_calls_enabled, outbound_test_mode, policy } = req.body || {};
    if (!business_id) return res.status(400).json({ error: 'business_id required' });

    const up1 = await supabase
      .from('businesses')
      .update({
        outbound_calls_enabled: !!outbound_calls_enabled,
        outbound_test_mode: !!outbound_test_mode,
      })
      .eq('id', business_id);
    if (up1.error) return res.status(500).json({ error: up1.error.message });

    if (policy) {
      const up2 = await supabase.from('outbound_policies').upsert({
        business_id,
        timezone: policy.timezone || 'America/Los_Angeles',
        daily_call_cap: policy.daily_call_cap ?? 0,
        quiet_hours: policy.quiet_hours || null, // {start:"HH:MM", end:"HH:MM"} or null
        dnc_list: Array.isArray(policy.dnc_list) ? policy.dnc_list : [],
      });
      if (up2.error) return res.status(500).json({ error: up2.error.message });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[POST /outbound-settings]', err);
    res.status(500).json({ error: 'Internal error', detail: String(err?.message || err) });
  }
});

export default router;
