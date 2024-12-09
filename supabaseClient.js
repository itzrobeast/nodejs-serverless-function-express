import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use correct key

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('[ERROR] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  throw new Error('Supabase configuration is invalid.');
}

// Ensure the client runs server-side only
if (typeof window !== 'undefined') {
  throw new Error('[SECURITY] Supabase Service Role Key should only be used server-side.');
}

// Debugging logs (for development only, remove in production)
console.log('[DEBUG] Supabase URL:', supabaseUrl);
console.log('[DEBUG] Supabase Service Role Key is', supabaseServiceKey ? 'provided' : 'missing');

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export default supabase;
