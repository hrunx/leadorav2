import type { Handler } from '@netlify/functions';

// small utilities here instead of deep import chains to avoid cold-start bloat
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supa = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

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
  await supa.from('user_searches').update({
    phase, progress_pct: pct, updated_at: new Date().toISOString(),
    ...(error ? { error: { message: String(error?.message||error) } } : {})
  }).eq('id', search_id);
}

async function retry<T>(fn:()=>Promise<T>, tries=3) {
  try { return await fn(); } catch (e:any) {
    if (tries<=1 || String(e?.status) !== '429') throw e;
    await sleep(300 + Math.random()*500);
    return retry(fn, tries-1);
  }
}

export const handler: Handler = async (event) => {
  // background functions return 202 immediately, Netlify runs the handler async
  try {
    const { search_id, user_id } = JSON.parse(event.body || '{}');
    if (!search_id || !user_id) return { statusCode: 400, body: 'search_id and user_id required' };

    console.log(`Starting background orchestration for search ${search_id}, user ${user_id}`);

    // PHASE 0
    await updateProgress(search_id, 'starting', 0);

    // Load orchestrator parts dynamically to reduce cold-start/bundle issues
    const [{ execBusinessPersonas }, { execDMPersonas }, { execBusinessDiscovery }, { execDMDiscovery }, { execMarketResearchParallel }] =
      await Promise.all([
        import('../../src/orchestration/exec-business-personas'),
        import('../../src/orchestration/exec-dm-personas'),
        import('../../src/orchestration/exec-business-discovery'),
        import('../../src/orchestration/exec-dm-discovery'),
        import('../../src/orchestration/exec-market-research-parallel'),
      ]);

    // START ALL AGENTS IN PARALLEL - everything begins immediately!
    console.log('Starting all agents in parallel for maximum speed...');
    
    // Start market research in background (non-blocking)
    const marketResearchPromise = retry(() => 
      withTimeout(execMarketResearchParallel({ search_id, user_id }), 300_000, 'market_research')
    ).catch(e => {
      console.error('Market research failed (non-blocking):', e.message);
      return null;
    });

    // Start business discovery immediately (non-blocking)
    await updateProgress(search_id, 'starting_discovery', 5);
    const businessDiscoveryPromise = retry(() => 
      withTimeout(execBusinessDiscovery({ search_id, user_id }), 240_000, 'business_discovery')
    ).catch(e => {
      console.error('Business discovery failed (non-blocking):', e.message);
      return null;
    });

    // Start personas in parallel (these typically finish first)
    await updateProgress(search_id, 'personas', 10);
    console.log('Starting persona generation...');
    await retry(() => withTimeout(Promise.all([
      limiter(()=>execBusinessPersonas({ search_id, user_id })),
      limiter(()=>execDMPersonas({ search_id, user_id })),
    ]), 120_000, 'personas'));

    // Wait for business discovery to complete (should have businesses by now)
    await updateProgress(search_id, 'businesses', 40);
    console.log('Waiting for business discovery...');
    const businessResult = await businessDiscoveryPromise;
    if (businessResult) {
      console.log('Business discovery completed successfully');
    } else {
      console.log('Business discovery failed - proceeding with available data');
    }

    // Now start decision makers (needs both personas and businesses)
    await updateProgress(search_id, 'decision_makers', 65);
    console.log('Starting DM discovery...');
    await retry(() => withTimeout(execDMDiscovery({ search_id, user_id }), 180_000, 'decision_makers'));

    // PHASE 4: Wait for market research to complete (should be done by now)
    await updateProgress(search_id, 'market_insights', 85);
    console.log('Waiting for market research to complete...');
    const marketResult = await marketResearchPromise;
    if (marketResult) {
      console.log('Market research completed successfully');
    } else {
      console.log('Market research failed - using fallback data');
    }

    await updateProgress(search_id, 'completed', 100);
    console.log(`Orchestration completed for search ${search_id}`);
    return { statusCode: 202, body: 'accepted' };
  } catch (e:any) {
    console.error('Background orchestration failed:', e);
    // best-effort: try to log search_id if present
    try {
      const { search_id, user_id } = JSON.parse(event.body || '{}');
      await updateProgress(search_id, 'failed', 100, e);
      await logUsage({
        user_id, search_id, provider: 'openai', endpoint: 'orchestration',
        status: 500, ms: 0, error: e.message
      });
    } catch {}
    return { statusCode: 202, body: 'accepted' }; // background function always returns 202
  }
};