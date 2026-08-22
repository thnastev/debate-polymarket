import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseAnonKey, configured } from './config';

/**
 * The client is created even when unconfigured, so importing this module never
 * throws — App.tsx shows a setup screen instead, which is far more useful at a
 * tournament than a white page.
 */
export const supabase = createClient(
  supabaseUrl || 'https://unconfigured.invalid',
  supabaseAnonKey || 'unconfigured',
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 10 } },
  },
);

export { configured };
