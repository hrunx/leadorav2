import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

function supa() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const WEIGHTS: Record<string, number> = {
  personas: 25,
  discovery: 35,
  dm_enrichment: 20,
  market_research: 20
};

function derivePhaseFromTasks(phases: Array<{ name: string; status: string }>): string {
  const order = ['personas','discovery','dm_enrichment','market_research'];
  for (let i = 0; i < order.length; i++) {
    const name = order[i];
    const t = phases.find(p => p.name === name);
    if (!t || t.status === 'queued' || t.status === 'running' || t.status === 'failed') {
      switch (name) {
        case 'personas': return 'business_personas';
        case 'discovery': return 'business_discovery';
        case 'dm_enrichment': return 'decision_makers';
        case 'market_research': return 'market_research';
      }
    }
  }
  return 'completed';
}

export const handler: Handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': event.headers.origin || '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Accept both GET ?search_id=... and POST { search_id }
  let search_id = (event.queryStringParameters?.search_id || '').trim();
  if (!search_id && event.httpMethod === 'POST') {
    try { search_id = String((JSON.parse(event.body || '{}') || {}).search_id || '').trim(); } catch {}
  }
  if (!search_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'search_id required' }) };

  // Fallback response if upstream is slow/unavailable
  const fallback = () => ({
    overall: 0,
    phases: [],
    status: 'queued',
    job_id: null,
    progress: { phase: 'starting', progress_pct: 0, status: 'queued', updated_at: new Date().toISOString() },
    data_counts: { businesses: 0, business_personas: 0, dm_personas: 0, decision_makers: 0, market_insights: 0 }
  });

  // Short-circuit if env is missing to avoid long hangs
  if (!process.env.SUPABASE_URL && !process.env.VITE_SUPABASE_URL) {
    return { statusCode: 200, headers, body: JSON.stringify(fallback()) };
  }

  const client = supa();
  try {
    // Most recent orchestrator job for this search (exclude sub-jobs like embeddings/mapping)
    const getJob = async () => client
      .from('jobs')
      .select('id, status, created_at')
      .eq('type', 'sequential_pipeline')
      .eq('payload->>search_id', search_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const withTimeout = async <T,>(p: Promise<T>, ms: number): Promise<T> => {
      return await Promise.race([
        p,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback() as any), ms))
      ]) as T;
    };

    const { data: job } = await withTimeout(getJob(), 6000);

    // Counts for convenience/back-compat with UI
    const count = async (table: string) => {
      const { count } = await client.from(table).select('id', { count: 'exact', head: true }).eq('search_id', search_id);
      return count || 0;
    };
    const [bp, dmp, biz, dm, mi] = await withTimeout(Promise.all([
      count('business_personas'),
      count('decision_maker_personas'),
      count('businesses'),
      count('decision_makers'),
      count('market_insights')
    ]), 6000).catch(() => [0,0,0,0,0] as const);

    if (!job) {
      return {
        statusCode: 200, headers, body: JSON.stringify({
          overall: 0,
          phases: [],
          status: 'queued',
          job_id: null,
          // Back-compat payload
          progress: { phase: 'starting', progress_pct: 0, status: 'queued', updated_at: new Date().toISOString() },
          data_counts: {
            businesses: biz, business_personas: bp, dm_personas: dmp, decision_makers: dm, market_insights: mi
          }
        })
      };
    }
    const job_id = (job as any).id as string;
    const { data: tasks } = await withTimeout(client
      .from('job_tasks')
      .select('name,status,progress,attempt,started_at,finished_at,error')
      .eq('job_id', job_id), 6000);
    const phases = (tasks || []).map(t => ({
      name: (t as any).name,
      status: (t as any).status,
      progress: Number((t as any).progress || 0),
      attempt: Number((t as any).attempt || 0),
      started_at: (t as any).started_at,
      finished_at: (t as any).finished_at,
      error: (t as any).error || null
    }));
    const overall = phases.reduce((acc, p) => acc + ((WEIGHTS[p.name] || 0) * (p.progress || 0)) / 100, 0);
    const status = (job as any).status || 'queued';

    // Back-compat progress shape
    const derivedPhase = derivePhaseFromTasks(phases);
    const progress_pct = Math.round(overall);
    const progress = { phase: derivedPhase, progress_pct, status, updated_at: new Date().toISOString() };
    const data_counts = { businesses: biz, business_personas: bp, dm_personas: dmp, decision_makers: dm, market_insights: mi };

    return { statusCode: 200, headers, body: JSON.stringify({ overall, phases, status, job_id, progress, data_counts }) };
  } catch (e: any) {
    // Always return quickly with fallback instead of timing out
    return { statusCode: 200, headers, body: JSON.stringify(fallback()) };
  }
};
