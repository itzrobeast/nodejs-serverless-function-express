import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Check for missing environment variables
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('[ERROR] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  throw new Error('Supabase configuration is invalid.');
}

// Ensure the client runs server-side only
if (typeof window !== 'undefined') {
  throw new Error('[SECURITY] Service Role Key should only be used server-side.');
}

console.log('[DEBUG] Creating Supabase client...');
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export default supabase;
