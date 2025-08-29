import { createClient } from '@supabase/supabase-js';

let _supa: any | null = null;

export function supaServer() {
  if (_supa) return _supa;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL or VITE_SUPABASE_URL is required');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_SERVICE_ROLE_KEY is required');
  _supa = createClient<any>(url as any, key as any, { auth: { persistSession: false, autoRefreshToken: false } } as any);
  return _supa;
}

