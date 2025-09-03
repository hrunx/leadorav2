import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, apikey, X-Requested-With',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  } as const;
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  try {
    const { search_id } = JSON.parse(event.body || '{}');
    if (!search_id) return { statusCode: 400, headers: cors, body: JSON.stringify({ ok:false, error:'search_id required' }) };
    const supa = createClient(URL, KEY, { auth: { persistSession: false } });
    const { error } = await supa
      .from('user_searches')
      .update({ phase: 'cancelled', status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', search_id);
    if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error: error.message }) };

    // Best-effort: mark background jobs for this search as failed/cancelled
    try {
      const { data: jobs } = await supa
        .from('jobs')
        .select('id')
        .eq('payload->>search_id', search_id)
        .neq('status', 'done');
      const jobIds = (jobs || []).map((j: any) => j.id);
      if (jobIds.length) {
        await supa.from('jobs').update({ status: 'failed', last_error: 'cancelled' }).in('id', jobIds);
        // Also mark job_tasks as failed for visibility
        await supa.from('job_tasks').update({ status: 'failed', error: 'cancelled' }).in('job_id', jobIds).neq('status', 'succeeded');
      }
    } catch { /* ignore */ }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok:true }) };
  } catch (e:any) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error: e?.message || 'cancel_failed' }) };
  }
};


