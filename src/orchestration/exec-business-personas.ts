import { runBusinessPersonas } from '../agents/business-persona.agent';
import { loadSearch, loadBusinessPersonas } from '../tools/db.read';
import { insertBusinessPersonas, updateSearchProgress } from '../tools/db.write';
import { callOpenAIChatJSON, resolveModel } from '../agents/clients';
import logger from '../lib/logger';

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
  // Run agent with a watchdog timeout (allow slower LLM responses)
  const RUN_TIMEOUT_MS = Math.max(20000, Number(process.env.BP_AGENT_TIMEOUT_MS || 20000));
  try {
    const outcome = await Promise.race<string>([
      runBusinessPersonas(agentSearch).then(() => 'success').catch((e: any) => {
        logger.warn('runBusinessPersonas error (non-blocking)', { search_id: agentSearch.id, error: e?.message || e });
        return 'error';
      }),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), RUN_TIMEOUT_MS))
    ]);
    if (outcome === 'timeout') {
      logger.warn('runBusinessPersonas timed out', { search_id: agentSearch.id });
    }
  } catch (e: any) {
    logger.warn('runBusinessPersonas failed', { search_id: agentSearch.id, error: e?.message || e });
  }

  // If still empty, run a final ultra-fast minimal LLM generation (strict LLM, minimal schema)
  try {
    const existing = await loadBusinessPersonas(agentSearch.id);
    if (!existing || existing.length === 0) {
      const minimalPrompt = `Return ONLY JSON: {"personas":[{...},{...},{...}]} for search_id=${agentSearch.id}. Each item keys: title, rank (1..3), match_score (80..100), demographics:{industry,companySize,geography,revenue}, market_potential:{totalCompanies,avgDealSize,conversionRate}.`;
      try {
        const text = await callOpenAIChatJSON({
          model: resolveModel('light'),
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
        } catch (e: any) {
          logger.warn('Minimal LLM personas parse failed', { search_id: agentSearch.id, error: e?.message || e });
        }
      } catch (e: any) {
        logger.warn('Minimal LLM personas call failed', { search_id: agentSearch.id, error: e?.message || e });
      }
    }
  } catch (e: any) {
    logger.warn('Business personas post-check failed', { search_id: agentSearch.id, error: e?.message || e });
  }
  return true;
}