import { createClient } from '@supabase/supabase-js';

let _supa: ReturnType<typeof createClient> | null = null;
function supa() {
  if (_supa) return _supa;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env missing for jobs');
  _supa = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _supa;
}

export type JobPayload = Record<string, any>;

export async function enqueueJob(type: string, payload: JobPayload, opts?: { run_at?: string; max_attempts?: number }) {
  const client = supa();
  const { error } = await client.from('jobs').insert({
    type,
    payload,
    run_at: opts?.run_at || new Date().toISOString(),
    max_attempts: typeof opts?.max_attempts === 'number' ? opts.max_attempts : 3,
    status: 'queued'
  });
  if (error) throw error;
}

