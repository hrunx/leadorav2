import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

import { orchestrate } from '../../src/orchestration/orchestrate';
import { execBusinessPersonas } from '../../src/orchestration/exec-business-personas';
import { execDMPersonas } from '../../src/orchestration/exec-dm-personas';
import { execBusinessDiscovery } from '../../src/orchestration/exec-business-discovery';
import { execMarketResearchParallel } from '../../src/orchestration/exec-market-research-parallel';
import { serperSearch, serperPlaces } from '../../src/tools/serper';
import { mapBusinessesToPersonas, intelligentPersonaMapping } from '../../src/tools/persona-mapper';
import { insertBusinesses, updateSearchProgress } from '../../src/tools/db.write';

type StepResult = { step: string; status: 'ok' | 'fail'; ms: number; details?: any; error?: string };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(
  SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export const handler: Handler = async (event) => {
  const startedAt = Date.now();
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, apikey, X-Requested-With',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  } as const;
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  const results: StepResult[] = [];
  const runStep = async (name: string, fn: () => Promise<any>) => {
    const t0 = Date.now();
    try {
      const details = await fn();
      const ms = Date.now() - t0;
      results.push({ step: name, status: 'ok', ms, details });
    } catch (e: any) {
      const ms = Date.now() - t0;
      results.push({ step: name, status: 'fail', ms, error: e?.message || String(e) });
    }
  };

  try {
    const { search_id: existingSearchId, user_id: suppliedUserId, quick } = JSON.parse(event.body || '{}');

    // 1) Env sanity check
    await runStep('env.check', async () => {
      const env = {
        OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
        GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
        SERPER_KEY: !!process.env.SERPER_KEY,
        DEEPSEEK_API_KEY: !!process.env.DEEPSEEK_API_KEY,
        VITE_SUPABASE_URL: !!process.env.VITE_SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY
      };
      return env;
    });

    // 2) DB connectivity
    await runStep('db.ping', async () => {
      const { error } = await supa.from('app_users').select('id').limit(1);
      if (error) throw error;
      return { ok: true };
    });

    // 3) Create or reuse a search
    let userId = suppliedUserId || '00000000-0000-0000-0000-000000000001';
    let searchId = existingSearchId as string | undefined;
    let product_service = 'AI-powered CRM software';
    let industries = ['Technology'];
    let countries = ['United States'];

    if (!searchId) {
      await runStep('search.create', async () => {
        const { data, error } = await supa
          .from('user_searches')
          .insert({
            user_id: userId,
            search_type: 'customer',
            product_service,
            industries,
            countries,
            status: 'in_progress',
            phase: 'starting',
            progress_pct: 0
          })
          .select('id')
          .single();
        if (error) throw error;
        searchId = data!.id;
        return { search_id: searchId };
      });
    }

    if (!searchId) throw new Error('search_id unresolved');

    // 4) Run agents individually (skip in quick mode to avoid timeouts during local invoke)
    if (!quick) {
      await runStep('agent.business_personas', () => execBusinessPersonas({ search_id: searchId!, user_id: userId }));
      await runStep('agent.dm_personas', () => execDMPersonas({ search_id: searchId!, user_id: userId }));
      await runStep('agent.business_discovery', () => execBusinessDiscovery({ search_id: searchId!, user_id: userId }));
      await runStep('agent.market_research', () => execMarketResearchParallel({ search_id: searchId!, user_id: userId }));
    }

    // 5) Tools: Serper search/places
    await runStep('tool.serper.search', async () => {
      const r = await serperSearch('crm software market size', 'us', quick ? 1 : 3);
      return { success: r.success, count: r.items?.length || 0 };
    });
    await runStep('tool.serper.places', async () => {
      const places = await serperPlaces('crm software companies', 'United States', quick ? 1 : 3);
      return { count: places.length };
    });

    // 6) Persona mapping tools
    await runStep('tool.persona.mapBusinessesToPersonas', async () => {
      await mapBusinessesToPersonas(searchId!);
      return { ok: true };
    });
    await runStep('tool.persona.intelligentPersonaMapping', async () => {
      const out = await intelligentPersonaMapping(searchId!);
      return out || { ok: true };
    });

    // 7) Insert a small business set + update progress to test DB writes
    await runStep('db.insert.businesses', async () => {
      const rows = [
        {
          search_id: searchId!,
          user_id: userId,
          persona_id: null,
          name: 'TestCo CRM',
          industry: 'Technology',
          country: 'United States',
          address: 'San Francisco, CA',
          city: 'San Francisco',
          website: 'https://example.com',
          size: '200-1000',
          revenue: '$50M',
          description: 'Test CRM vendor',
          match_score: 80,
          persona_type: 'business',
          relevant_departments: ['Engineering'],
          key_products: ['CRM'],
          recent_activity: ['Launched product']
        }
      ];
      const ins = await insertBusinesses(rows as any);
      return { inserted: ins.length };
    });

    await runStep('db.progress.update', async () => {
      await updateSearchProgress(searchId!, 100, 'completed', 'completed');
      return { ok: true };
    });

    // 8) Orchestrator end-to-end (skip in quick mode)
    if (!quick) {
      await runStep('orchestrator.full', async () => {
        await orchestrate(searchId!, userId);
        return { ok: true };
      });
    }

    const failed = results.filter(r => r.status === 'fail').length;
    const ok = results.length - failed;
    const body = {
      started_at: new Date(startedAt).toISOString(),
      duration_ms: Date.now() - startedAt,
      ok,
      failed,
      search_id: searchId,
      results
    };
    return { statusCode: failed ? 207 : 200, headers: { 'Content-Type': 'application/json', ...cors }, body: JSON.stringify(body, null, 2) };
  } catch (e: any) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};


