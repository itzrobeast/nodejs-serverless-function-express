import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use correct key

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('[ERROR] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  throw new Error('Supabase configuration is invalid.');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export default supabase;
