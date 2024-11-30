const { createClient } = require('@supabase/supabase-js');

// Use environment variables to keep secrets secure
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = supabase;
