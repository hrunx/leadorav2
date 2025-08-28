import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import logger from '../../src/lib/logger';
import { processJob } from '../../src/jobs/handlers';

function supa() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const handler: Handler = async (_event) => {
  const headers = { 'Content-Type': 'application/json' };
  const client = supa();
  const workerId = `netlify-${Math.random().toString(36).slice(2,8)}`;
  const maxToClaim = 5;
  let processed = 0;
  try {
    logger.info('jobs-dispatcher tick', { workerId });
    for (let i = 0; i < maxToClaim; i++) {
      // Claim one job at a time via RPC
      const { data: job, error } = await client.rpc('claim_job', { worker_id: workerId, wanted_types: null });
      if (error) {
        logger.warn('claim_job rpc error', { error: error.message });
        break;
      }
      if (!job || (Array.isArray(job) && job.length === 0)) break;
      const row = Array.isArray(job) ? job[0] : job; // RPC returns setof jobs
      try {
        logger.info('processing job', { id: row.id, type: row.type });
        await processJob(row);
        await client.rpc('complete_job', { job_id: row.id, worker_id: workerId });
        logger.info('job completed', { id: row.id, type: row.type });
        processed++;
      } catch (e: any) {
        logger.warn('job failed; scheduling retry', { id: row.id, type: row.type, error: e?.message || String(e) });
        await client.rpc('fail_job', { job_id: row.id, worker_id: workerId, error_text: String(e?.message || e), backoff_seconds: 30 });
      }
    }
    logger.info('jobs-dispatcher finished', { workerId, processed });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, processed }) };
  } catch (e: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message, processed }) };
  }
};
