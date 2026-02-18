
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qdubmalosujiyhgcoace.supabase.co';
const supabaseKey = 'sb_publishable_qN5EIl1vedcXWiDGaLv3lg_8BrG8oGS';

// Standard client for main application state and session persistence
export const supabase = createClient(supabaseUrl, supabaseKey);

// Secondary client with persistSession: false for administrative actions like adding users
// This prevents the current admin session from being overwritten by the newly created user
export const adminActionClient = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});
