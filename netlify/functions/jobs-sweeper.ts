import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

function supa() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const handler: Handler = async () => {
  const client = supa();
  try {
    // expire idempotency cache
    await client.from('idempotency_cache').delete().lt('ttl_at', new Date().toISOString());

    // requeue stuck tasks (>20m running)
    const threshold = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const { data: stuck } = await client
      .from('job_tasks')
      .select('id,job_id')
      .eq('status', 'running')
      .lt('started_at', threshold);
    for (const t of (stuck || [])) {
      await client.from('job_tasks').update({ status: 'queued' }).eq('id', (t as any).id);
    }
    return { statusCode: 200, body: 'ok' };
  } catch (e: any) {
    return { statusCode: 500, body: String(e?.message || e) };
  }
};

