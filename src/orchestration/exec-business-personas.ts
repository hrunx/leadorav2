import { BusinessPersonaAgent, runBusinessPersonas as runBPDetailed } from '../agents/business-persona.agent';
import { run as runAgent } from '@openai/agents';
import { loadSearch, loadBusinessPersonas } from '../tools/db.read';
import { insertBusinessPersonas, updateSearchProgress, appendAgentEvent } from '../tools/db.write';
import { callOpenAIChatJSON, resolveModel } from '../agents/clients';
import logger from '../lib/logger';
import { generateBusinessPersonasFast } from '../agents/fast-persona-generator';

export async function execBusinessPersonas(payload: {
  search_id: string;
  user_id: string;
}) {
  const search = await loadSearch(payload.search_id);
  if (!search) throw new Error(`Search ${payload.search_id} not found`);

  // Normalize for strict agent typing
  const agentSearch = {
    id: String((search as any)?.id || payload.search_id),
    user_id: String((search as any)?.user_id || payload.user_id),
    product_service: String((search as any)?.product_service || ''),
    industries: Array.isArray((search as any)?.industries) ? ((search as any).industries as string[]) : [],
    countries: Array.isArray((search as any)?.countries) ? ((search as any).countries as string[]) : [],
    search_type: ((search as any)?.search_type === 'supplier' ? 'supplier' : 'customer') as 'customer' | 'supplier',
  };

  // Development short-circuit: avoid Netlify CLI 30s timeout by inserting fast personas
  const isLocalDev =
    String(process.env.NETLIFY_DEV) === 'true' ||
    process.env.NODE_ENV === 'development' ||
    String(process.env.LOCAL_FAST_BP) === '1';
  if (isLocalDev) {
    try {
      const inserted = await generateBusinessPersonasFast(agentSearch);
      try { await appendAgentEvent(agentSearch.id, 'bp_fast_dev_inserted', { count: Array.isArray(inserted) ? inserted.length : 0 }); } catch {}
      logger.info('Fast dev path used for Business Personas', { search_id: agentSearch.id });
      return true;
    } catch (e:any) {
      logger.warn('Fast dev path failed, continuing with agent path', { search_id: agentSearch.id, error: e?.message || e });
    }
  }
  // Run Agent (tool-driven) with a short watchdog timeout for fast first personas
  const RUN_TIMEOUT_MS = Math.max(20000, Number(process.env.BP_AGENT_TIMEOUT_MS || 20000));
  try {
    logger.info('BusinessPersonaAgent starting', { search_id: agentSearch.id, model: resolveModel('light') });
    try { await appendAgentEvent(agentSearch.id, 'bp_exec_start', { model: resolveModel('light') }); } catch {}
    const outcome = await Promise.race<string>([
      (async () => {
        const msg = `search_id=${agentSearch.id} user_id=${agentSearch.user_id} product_service="${agentSearch.product_service}" industries="${agentSearch.industries.join(', ')}" countries="${agentSearch.countries.join(', ')}" search_type=${agentSearch.search_type}`;
        await runAgent(BusinessPersonaAgent, msg);
        return 'success';
      })().catch((e:any)=>{
        logger.warn('BusinessPersonaAgent run failed', { search_id: agentSearch.id, error: e?.message || e });
        return 'error';
      }),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), RUN_TIMEOUT_MS))
    ]);
    if (outcome === 'timeout') {
      logger.warn('runBusinessPersonas timed out', { search_id: agentSearch.id });
    }
    try { await appendAgentEvent(agentSearch.id, 'bp_exec_outcome', { outcome }); } catch {}
  } catch (e: any) {
    logger.warn('runBusinessPersonas failed', { search_id: agentSearch.id, error: e?.message || e });
    try { await appendAgentEvent(agentSearch.id, 'bp_exec_exception', { error: String(e?.message || e).slice(0,200) }); } catch {}
  }

  // If still empty, run a final ultra-fast minimal LLM generation (strict LLM, minimal schema)
  try {
    const existing = await loadBusinessPersonas(agentSearch.id);
    const existingCount = Array.isArray(existing)? existing.length : 0;
    logger.info('BusinessPersonaAgent post-run check', { search_id: agentSearch.id, count: existingCount });
    try { await appendAgentEvent(agentSearch.id, 'bp_post_run_check', { count: existingCount }); } catch {}
    if (!existing || existing.length === 0) {
      // Fallback 1: Use robust direct LLM pipeline with triage (GPT-5 -> Gemini -> DeepSeek)
      try {
        await runBPDetailed({
          id: agentSearch.id,
          user_id: agentSearch.user_id,
          product_service: agentSearch.product_service,
          industries: agentSearch.industries,
          countries: agentSearch.countries,
          search_type: agentSearch.search_type
        });
      } catch (e:any) {
        logger.warn('runBPDetailed fallback failed', { search_id: agentSearch.id, error: e?.message || e });
      }
      // Re-check after robust fallback
      const afterDetailed = await loadBusinessPersonas(agentSearch.id);
      if (Array.isArray(afterDetailed) && afterDetailed.length > 0) {
        logger.info('Personas present after detailed fallback', { search_id: agentSearch.id, count: afterDetailed.length });
        return true;
      }

      // Fallback 2: Minimal ultra-fast JSON-only generation and insert
      const minimalPrompt = `Return ONLY JSON: {"personas":[{...},{...},{...}]} for search_id=${agentSearch.id}. Each item keys: title, rank (1..3), match_score (80..100), demographics:{industry,companySize,geography,revenue}, market_potential:{totalCompanies,avgDealSize,conversionRate}.`;
      try {
        const text = await callOpenAIChatJSON({
          model: resolveModel('ultraLight'),
          system: 'You are a JSON generator. Output must be valid JSON object with key "personas".',
          user: minimalPrompt,
          temperature: 0.1,
          maxTokens: 500,
          requireJsonObject: true,
          verbosity: 'low',
          timeoutMs: 7000,
          retries: 0
        });
        try {
          const obj = JSON.parse(text || '{}');
          const arr = Array.isArray(obj?.personas) ? obj.personas.slice(0,3) : [];
          if (arr.length > 0) {
            const rows = arr.map((p: any, i: number) => ({
              search_id: agentSearch.id,
              user_id: agentSearch.user_id,
              title: String(p?.title || `Persona ${i+1}`),
              rank: Number(p?.rank || (i+1)),
              match_score: Number(p?.match_score || 85),
              demographics: p?.demographics || {},
              characteristics: {},
              behaviors: {},
              market_potential: p?.market_potential || {},
              locations: []
            }));
            await insertBusinessPersonas(rows);
            await updateSearchProgress(agentSearch.id, 15, 'business_personas');
            logger.info('Inserted minimal LLM personas', { search_id: agentSearch.id });
            try { await appendAgentEvent(agentSearch.id, 'bp_minimal_inserted', { count: rows.length }); } catch {}
            
            // Trigger business-persona remapping after inserting new personas
            try {
              const { intelligentPersonaMapping } = await import('../tools/persona-mapper');
              void intelligentPersonaMapping(agentSearch.id).catch((err: any) =>
                logger.warn('Post-insertion persona mapping failed', { search_id: agentSearch.id, error: err?.message || err })
              );
            } catch (error: any) {
              logger.warn('Failed to import persona mapping', { search_id: agentSearch.id, error: error?.message || error });
            }
          }
          else {
            const sample = (text || '').slice(0, 300);
            logger.warn('Minimal LLM personas call returned empty array', { search_id: agentSearch.id, raw: sample });
            try { await appendAgentEvent(agentSearch.id, 'bp_minimal_empty', { sample }); } catch {}
          }
        } catch (e: any) {
          logger.warn('Minimal LLM personas parse failed', { search_id: agentSearch.id, error: e?.message || e });
          try { await appendAgentEvent(agentSearch.id, 'bp_minimal_parse_failed', { error: String(e?.message || e).slice(0,200) }); } catch {}
        }
      } catch (e: any) {
        logger.warn('Minimal LLM personas call failed', { search_id: agentSearch.id, error: e?.message || e });
        try { await appendAgentEvent(agentSearch.id, 'bp_minimal_call_failed', { error: String(e?.message || e).slice(0,200) }); } catch {}
      }
    }
  } catch (e: any) {
    logger.warn('Business personas post-check failed', { search_id: agentSearch.id, error: e?.message || e });
    try { await appendAgentEvent(agentSearch.id, 'bp_post_run_exception', { error: String(e?.message || e).slice(0,200) }); } catch {}
  }
  return true;
}