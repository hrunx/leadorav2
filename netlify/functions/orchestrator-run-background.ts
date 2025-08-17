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
  let stopPersonaListener: (() => Promise<void>) | null = null;
  let cancelled = false;
  try {
    const { search_id, user_id } = JSON.parse(event.body || '{}');
    if (!search_id || !user_id) return { statusCode: 400, headers: cors, body: 'search_id and user_id required' };

    logger.info('Starting background orchestration', { search_id, user_id });

    // PHASE 0
    await updateProgress(search_id, 'starting', 0);

    // Load orchestrator parts dynamically to reduce cold-start/bundle issues
    const [
      { execBusinessPersonas },
      { execDMPersonas },
      { execBusinessDiscovery },
      { execMarketResearchParallel },
      personaMapper,
      { appendAgentEvent }
    ] = await Promise.all([
      import('../../src/orchestration/exec-business-personas'),
      import('../../src/orchestration/exec-dm-personas'),
      import('../../src/orchestration/exec-business-discovery'),
      import('../../src/orchestration/exec-market-research-parallel'),
      import('../../src/tools/persona-mapper'),
      import('../../src/tools/db.write')
    ]);
    const { startPersonaMappingListener, mapBusinessesToPersonas } = personaMapper;

    // START ALL AGENTS IN PARALLEL - everything begins immediately!
    logger.info('Starting all agents in parallel for maximum speed...');

    // Start market research in background (non-blocking)
    const marketResearchPromise = retry(() =>
      withTimeout(execMarketResearchParallel({ search_id, user_id }), 120_000, 'market_research')
    ).catch(e => {
      logger.warn('Market research failed (non-blocking)', { error: e.message });
      return null;
    });

    // Start business discovery immediately (non-blocking)
    await updateProgress(search_id, 'business_discovery', 5);
    // Defer business→persona mapping until business personas are ready; still keep listener ready
    stopPersonaListener = startPersonaMappingListener(search_id);
    const businessDiscoveryPromise = retry(() =>
      withTimeout(execBusinessDiscovery({ search_id, user_id }), 120_000, 'business_discovery')
    ).catch(e => {
      logger.warn('Business discovery failed (non-blocking)', { error: e.message });
      return null;
    });

    // Start business personas first (non-blocking), then DM personas once business personas exist
    await updateProgress(search_id, 'business_personas', 10);
    logger.info('Starting business persona generation...');
    const businessPersonasPromise = retry(() => withTimeout(limiter(() => execBusinessPersonas({ search_id, user_id })), 90_000, 'business_personas'))
      .catch(e => {
        logger.warn('Business persona generation failed (non-blocking)', { error: e?.message || e });
        return null;
      });
    void appendAgentEvent(search_id, 'STARTED_BUSINESS_PERSONAS');

    // Poll for business personas to exist (max ~30s) before starting DM personas to align with requested pipeline
    const waitForBusinessPersonas = async () => {
      const start = Date.now();
      while (Date.now() - start < 30000) {
        const { count } = await supa
          .from('business_personas')
          .select('id', { count: 'exact', head: true })
          .eq('search_id', search_id);
        if ((count || 0) > 0) return true;
        await sleep(1500);
      }
      return false;
    };
    // Check cancellation flag from DB before continuing
    const checkCancelled = async () => {
      const { data } = await supa.from('user_searches').select('status').eq('id', search_id).single();
      cancelled = (data?.status === 'cancelled');
      return cancelled;
    };
    const haveBusinessPersonas = cancelled ? false : await waitForBusinessPersonas();
    if (!haveBusinessPersonas) {
      logger.warn('Business personas not detected in time; continuing to start DM personas to avoid delay');
    }
    await updateProgress(search_id, 'dm_personas', 12);
    logger.info('Starting decision-maker persona generation...');
    const dmPersonasPromise = retry(() => withTimeout(limiter(() => execDMPersonas({ search_id, user_id })), 90_000, 'dm_personas'))
      .catch(e => {
        logger.warn('DM persona generation failed (non-blocking)', { error: e?.message || e });
        return null;
      });
    void appendAgentEvent(search_id, 'STARTED_DM_PERSONAS', { after_business_personas: haveBusinessPersonas });

    // After personas exist, perform initial business→persona mapping in batch
    try {
      await mapBusinessesToPersonas(search_id);
    } catch (e: any) {
      logger.warn('Initial business→persona mapping failed (will retry via listener)', { error: e?.message || e });
    }

    // Business discovery continues in background; update progress snapshot
    await updateProgress(search_id, 'business_discovery', 40);

    // PHASE 4: Wait for market research to complete (should be doing work in background)
    await updateProgress(search_id, 'market_research', 85);
    logger.info('Waiting for market research to complete...');
    const marketResult = await marketResearchPromise;
    if (marketResult) {
      logger.info('Market research completed successfully');
    } else {
      logger.warn('Market research failed - using fallback data');
    }

    // Ensure business discovery has finished before marking completed
    await businessDiscoveryPromise;
    // Best-effort wait for personas, but do not block completion
    try { await businessPersonasPromise; } catch {}
    try { await dmPersonasPromise; } catch {}
    if (!await checkCancelled()) {
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
    if (stopPersonaListener) await stopPersonaListener();
  }
};