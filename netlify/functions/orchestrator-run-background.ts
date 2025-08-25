import { Handler } from '@netlify/functions';
import logger from '../../src/lib/logger';

// small utilities here instead of deep import chains to avoid cold-start bloat
import { createClient } from '@supabase/supabase-js';
// Removed unused OpenAI import

const SUPABASE_URL_BG = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY_BG = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;
const supa = createClient(SUPABASE_URL_BG, SUPABASE_SERVICE_ROLE_KEY_BG, { auth: { persistSession: false } });
// Remove unused client instance to avoid warnings

const sleep = (ms:number)=>new Promise(r=>setTimeout(r,ms));
const withTimeout = <T>(p:Promise<T>, ms:number, label='op') =>
  Promise.race([p, new Promise<T>((_,rej)=>setTimeout(()=>rej(new Error(`timeout:${label}`)),ms))]);

// Simple rate limiter without external deps
const createLimiter = (maxConcurrent: number) => {
  let running = 0;
  const queue: Array<() => void> = [];
  
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        running++;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          running--;
          if (queue.length > 0) {
            const next = queue.shift()!;
            next();
          }
        }
      };

      if (running < maxConcurrent) {
        execute();
      } else {
        queue.push(execute);
      }
    });
  };
};

const limiter = createLimiter(5); // cap parallelism

async function logUsage(input: {
  user_id: string; search_id: string;
  provider: 'serper'|'deepseek'|'gemini'|'openai';
  endpoint: string; status: number; ms: number;
  request?: any; response?: any; error?: string;
}) {
  try {
    await supa.from('api_usage_logs').insert({
      user_id: input.user_id, search_id: input.search_id, provider: input.provider,
      endpoint: input.endpoint, status: input.status, ms: input.ms,
      request: input.request ?? {}, response: input.response ?? {}, created_at: new Date().toISOString(),
      cost_usd: 0, tokens: 0
    });
  } catch {}
}

async function updateProgress(search_id:string, phase:string, pct:number, error?:any) {
  const status = phase === 'completed' ? 'completed' : phase === 'failed' ? 'failed' : phase === 'cancelled' ? 'cancelled' : 'in_progress';
  await supa.from('user_searches').update({
    phase, status, progress_pct: pct, updated_at: new Date().toISOString(),
    ...(error ? { error: { message: String(error?.message||error) } } : {})
  }).eq('id', search_id);
}

async function retry<T>(fn:()=>Promise<T>, tries=3) {
  try { return await fn(); } catch (e:any) {
    if (tries<=1 || String(e?.status) !== '429') throw e;
    // Use deterministic delay to avoid random timing issues
  await sleep(500); // Fixed 500ms delay for consistency
    return retry(fn, tries-1);
  }
}

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, apikey, X-Requested-With',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  // background functions return 202 immediately, Netlify runs the handler async
  let cancelled = false;
  try {
    const { search_id, user_id } = JSON.parse(event.body || '{}');
    if (!search_id || !user_id) return { statusCode: 400, headers: cors, body: 'search_id and user_id required' };

    logger.info('Starting background orchestration', { search_id, user_id });

    // PHASE 0
    await updateProgress(search_id, 'starting', 0);

    // Use Agent-driven orchestrator for coordination
    const [{ runOrchestratorAgent }] = await Promise.all([
      import('../../src/agents/orchestrator.agent')
    ]);

    // Single call: let the MainOrchestratorAgent coordinate sub-agents
    await runOrchestratorAgent({ search_id, user_id });
    // best-effort: check cancelled flag
    const isCancelled = await (async () => {
      try {
        const { data } = await supa.from('user_searches').select('status').eq('id', search_id).single();
        return (data?.status === 'cancelled');
      } catch { return false; }
    })();
    if (!isCancelled) {
      await updateProgress(search_id, 'completed', 100);
    } else {
      logger.info('Search was cancelled; marking cancelled state retained');
    }
    logger.info('Orchestration completed', { search_id });
    return { statusCode: 202, headers: cors, body: 'accepted' };
  } catch (e:any) {
    logger.error('Background orchestration failed', { error: e });
    // best-effort: try to log search_id if present
    try {
      const { search_id, user_id } = JSON.parse(event.body || '{}');
      await updateProgress(search_id, 'failed', 100, e);
      await logUsage({
        user_id, search_id, provider: 'openai', endpoint: 'orchestration',
        status: 500, ms: 0, error: e.message
      });
    } catch {}
    return { statusCode: 202, headers: cors, body: 'accepted' }; // background function always returns 202
  } finally {
    // no-op
  }
};