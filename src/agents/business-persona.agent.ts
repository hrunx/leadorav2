import { Agent, tool } from '@openai/agents';
import { insertBusinessPersonas, updateSearchProgress, insertPersonaCache } from '../tools/db.write';
// import { loadBusinesses } from '../tools/db.read';
import { loadPersonaCache } from '../tools/db.read';
import { resolveModel, callOpenAIChatJSON, callGeminiText, callDeepseekChatJSON } from './clients';
import { extractJson } from '../tools/json';
import { ensureUniqueTitles } from './business-persona.helpers';

import {
  sanitizePersona,
  isRealisticPersona,
  isGenericTitle,
  BusinessPersona as Persona,
} from '../tools/persona-validation';
import Ajv from 'ajv';



interface StoreBusinessPersonasToolInput {
  search_id: string;
  user_id: string;
  personas: Persona[];
}

interface StoreBusinessPersonasToolOutput {
  success: boolean;
  message?: string;
  inserted_count?: number;
}

const ajv = new Ajv({ allErrors: true });

// Relaxed validation: only require core fields; other objects optional and open
const personaSchema: any = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    rank: { type: 'integer' },
    match_score: { type: 'integer' },
    demographics: { type: 'object', additionalProperties: true },
    characteristics: { type: 'object', additionalProperties: true },
    behaviors: { type: 'object', additionalProperties: true },
    market_potential: { type: 'object', additionalProperties: true },
    locations: { type: 'array', items: {} }
  },
  required: ['title', 'rank', 'match_score'],
  additionalProperties: true
};

const validatePersona = ajv.compile(personaSchema);

const storeBusinessPersonasTool = tool({
  name: 'storeBusinessPersonas',
  description: 'Persist exactly 3 business personas for a search.',
  parameters: {
    type: 'object',
    properties: {
      search_id: { type: 'string' },
      user_id: { type: 'string' },
      personas: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            rank: { type: 'integer' },
            match_score: { type: 'integer' },
            demographics: { type: 'object', additionalProperties: true },
            characteristics: { type: 'object', additionalProperties: true },
            behaviors: { type: 'object', additionalProperties: true },
            market_potential: { type: 'object', additionalProperties: true },
            locations: { type: 'array', items: { type: 'object', additionalProperties: true } }
          },
          required: ['title','rank','match_score'],
          additionalProperties: true
        }
      }
    },
    required: ['search_id','user_id','personas'],
    additionalProperties: false
  } as const,
  strict: true,
  execute: async (input: unknown) => {
    const { search_id, user_id, personas } = input as StoreBusinessPersonasToolInput;
    if (!Array.isArray(personas) || personas.length < 1) {
      throw new Error('Expected at least 1 persona.');
    }
    for (const p of personas) {
      if (!validatePersona(p)) {
        import('../lib/logger')
          .then(({ default: logger }) =>
            logger.error('Business persona validation failed', { errors: validatePersona.errors, persona: p })
          )
          .catch(() => {});
        throw new Error('Invalid business persona structure.');
      }
    }

    const rows = personas.slice(0,3).map((p:Persona)=>({
      search_id,
      user_id,
      title:p.title,
      rank:p.rank, 
      match_score:p.match_score,
      demographics:p.demographics||{}, 
      characteristics:p.characteristics||{},
      behaviors:p.behaviors||{}, 
      market_potential:p.market_potential||{},
      locations:p.locations||[]
    }));
    const result: StoreBusinessPersonasToolOutput = { success: true };
    try {
      const inserted = await insertBusinessPersonas(rows);
      result.inserted_count = Array.isArray(inserted) ? inserted.length : 0;
      try {
        await updateSearchProgress(search_id, 10, 'business_personas');
      } catch {}
      
      // Trigger business-persona remapping after tool execution
      if (inserted && Array.isArray(inserted) && inserted.length > 0) {
        try {
          const { intelligentPersonaMapping } = await import('../tools/persona-mapper');
          void intelligentPersonaMapping(search_id).catch((err: any) =>
            import('../lib/logger').then(({ default: logger }) =>
              logger.warn('Post-tool persona remapping failed', { search_id, error: err?.message || err })
            ).catch(() => {})
          );
        } catch (error: any) {
          import('../lib/logger').then(({ default: logger }) =>
            logger.warn('Failed to trigger post-tool persona remapping', { search_id, error: error?.message || error })
          ).catch(() => {});
        }
      }
    } catch (error) {
      result.success = false;
      result.message = `Failed to insert personas: ${(error as Error).message}`;
    }
    return result;
  }
});

export const BusinessPersonaAgent = new Agent({
  name: 'BusinessPersonaAgent',
  instructions: `Create exactly 3 business personas using the provided search criteria.

TASK: Call storeBusinessPersonas tool ONCE with all 3 personas. Each persona needs:
- title: Company type for the specific industry/country
- rank: 1-5 (1 = highest relevance to search)
- match_score: 80-100
- demographics: {industry, companySize, geography, revenue}
- characteristics: {painPoints, motivations, challenges, decisionFactors}
- behaviors: {buyingProcess, decisionTimeline, budgetRange, preferredChannels}
- market_potential: {totalCompanies, avgDealSize, conversionRate}
- locations: [specific cities/regions]

Use EXACT search criteria provided. Create personas of companies that would need/provide the specified product/service in the target country/industry.

CRITICAL: Call storeBusinessPersonas tool ONCE with complete data. Do not retry.`,
  tools: [storeBusinessPersonasTool],
  handoffDescription: 'Generates 3 hyper-personalized business personas tailored to exact search criteria',
  handoffs: [],
  // Use primary GPT-5 for higher quality, faster convergence
  model: 'gpt-4o-mini'
});

  // --- Helper: Validate persona realism ---
// removed legacy helper (unused)

// --- Helper: ensure market potential numbers are sane ---
function validateMarketPotential(persona: Persona, searchId: string): Persona | null {
  const mp = persona.market_potential || { totalCompanies: 0, avgDealSize: '', conversionRate: 0 };
  const errors: string[] = [];

  if (typeof mp.totalCompanies !== 'number' || mp.totalCompanies <= 0) {
    errors.push(`totalCompanies:${mp.totalCompanies}`);
    mp.totalCompanies = Math.max(1, Number(mp.totalCompanies) || 1);
  }
  if (typeof mp.conversionRate !== 'number' || mp.conversionRate < 0 || mp.conversionRate > 100) {
    errors.push(`conversionRate:${mp.conversionRate}`);
    mp.conversionRate = Math.min(100, Math.max(0, Number(mp.conversionRate) || 0));
  }

  if (errors.length) {
    import('../lib/logger')
      .then(({ default: logger }) => logger.warn('[BusinessPersona] Persona market_potential corrected', {
        search_id: searchId,
        title: persona.title,
        errors,
        corrected: { totalCompanies: mp.totalCompanies, conversionRate: mp.conversionRate }
      }))
      .catch(() => {});
  }

  if (mp.totalCompanies <= 0 || mp.conversionRate < 0 || mp.conversionRate > 100) {
    import('../lib/logger')
      .then(({ default: logger }) => logger.error('[BusinessPersona] Persona rejected after validation', {
        search_id: searchId,
        title: persona.title,
        market_potential: mp
      }))
      .catch(() => {});
    return null;
  }

  return { ...persona, market_potential: mp };
}

export async function runBusinessPersonas(search: {
  id:string; 
  user_id:string; 
  product_service:string; 
  industries:string[]; 
  countries:string[]; 
  search_type:'customer'|'supplier'
}) {
  try {
    let personas: Persona[] = [];

    const cacheKey = [
      search.product_service,
      [...search.industries].sort().join(','),
      [...search.countries].sort().join(',')
    ].join('|').toLowerCase();

    const cached = await loadPersonaCache(cacheKey);
    if (Array.isArray(cached) && cached.length) {
      const accepted = cached.slice(0,3).map((p, i) => sanitizePersona('business', p, i, search));
      if (accepted.length === 3 && accepted.every(p => isRealisticPersona('business', p))) {
        const rows = accepted.map((p: Persona) => ({
          search_id: search.id,
          user_id: search.user_id,
          title: p.title,
          rank: p.rank,
          match_score: p.match_score,
          demographics: p.demographics || {},
          characteristics: p.characteristics || {},
          behaviors: p.behaviors || {},
          market_potential: p.market_potential || {},
          locations: p.locations || []
        }));
        await insertBusinessPersonas(rows);
        await updateSearchProgress(search.id, 10, 'business_personas');
        import('../lib/logger').then(({ default: logger }) => logger.info('Loaded business personas from cache', { search_id: search.id })).catch(()=>{});
        
        // Trigger business-persona remapping for cached personas
        try {
          const { intelligentPersonaMapping } = await import('../tools/persona-mapper');
          void intelligentPersonaMapping(search.id).catch((err: any) =>
            import('../lib/logger').then(({ default: logger }) =>
              logger.warn('Post-cached persona remapping failed', { search_id: search.id, error: err?.message || err })
            ).catch(() => {})
          );
        } catch (error: any) {
          import('../lib/logger').then(({ default: logger }) =>
            logger.warn('Failed to trigger cached persona remapping', { search_id: search.id, error: error?.message || error })
          ).catch(() => {});
        }
        return;
      }
    }

    // LLM-first approach

    const improvedPrompt = `Generate 3 business personas (COMPANY ARCHETYPES) for:
- search_id=${search.id}
- user_id=${search.user_id}
- product_service=${search.product_service}
- industries=${search.industries.join(', ')}
- countries=${search.countries.join(', ')}
- search_type=${search.search_type}
- lens=${search.search_type==='customer'?'companies that need':'companies that sell/provide'}

CRITICAL: Each persona must have:
- Realistic, industry-specific, non-generic, non-default, non-empty values for every field.
- Use plausible geographies, company sizes, revenues, pain points, motivations, challenges, decision factors, buying processes, timelines, budget ranges, preferred channels, market potential, and locations.
- Titles MUST be descriptive company archetypes tied to the product_service and lens.
- Return ONLY JSON: {"personas": [ ...exactly 3 items... ] }`;

    const tryParsePersonas = (text: string): Persona[] => {
      try {
        const obj = JSON.parse(text || '{}');
        return Array.isArray((obj as any)?.personas) ? (obj as any).personas as Persona[] : [];
      } catch {
        const ex = extractJson(text);
        try {
          const obj = typeof ex === 'string' ? JSON.parse(ex) : ex;
          return Array.isArray((obj as any)?.personas) ? (obj as any).personas as Persona[] : [];
        } catch { return []; }
      }
    };

    const acceptPersonas = (arr: any[]): Persona[] => {
      const take = (arr || []).slice(0, 3);
      if (take.length === 0) return [];
      const sanitized = take.map((p, i) => sanitizePersona('business', p, i, search));
      const validated = sanitized
        .map(p => validateMarketPotential(p, search.id))
        .filter((p): p is Persona => p !== null);
      return validated;
    };

    const hasGenericTitles = (arr: Persona[]): boolean => {
      const titles = arr.map(p => (p.title || '').toLowerCase());
      const duplicates = new Set<string>();
      let dup = false;
      for (const t of titles) {
        if (duplicates.has(t)) { dup = true; break; }
        duplicates.add(t);
      }
      return arr.some(p => isGenericTitle(p.title)) || dup;
    };

    if (!personas.length) {
      // Sequential fallback: GPT-4o-mini -> Gemini -> DeepSeek
      try {
        // 1) Try GPT-4o-mini first
        const text = await callOpenAIChatJSON({
          model: resolveModel('primary'),
          system: 'Return ONLY JSON: {"personas": [ ... ] } with exactly 3 complete persona objects.',
          user: improvedPrompt,
          temperature: 0.2,
          maxTokens: 1000,
          requireJsonObject: true,
          timeoutMs: 20000,
          retries: 1
        });
        const arr = tryParsePersonas(text);
        const accepted = acceptPersonas((arr || []).slice(0, 3));
        if (accepted.length === 3) {
          personas = accepted;
          import('../lib/logger').then(({ default: logger }) => logger.info('Business personas generated with GPT-4o-mini', { search_id: search.id })).catch(()=>{});
        }
      } catch (error: any) {
        import('../lib/logger').then(({ default: logger }) => logger.warn('GPT-4o-mini failed for business personas, trying Gemini', { search_id: search.id, error: error?.message })).catch(()=>{});
      }

      if (!personas.length) {
        try {
          // 2) Gemini fallback
          const text = await callGeminiText('gemini-2.0-flash-exp', improvedPrompt + '\nReturn ONLY JSON: {"personas": [ ... ] }', 20000, 1);
          const arr = tryParsePersonas(text);
          const accepted = acceptPersonas((arr || []).slice(0, 3));
          if (accepted.length === 3) {
            personas = accepted;
            import('../lib/logger').then(({ default: logger }) => logger.info('Business personas generated with Gemini', { search_id: search.id })).catch(()=>{});
          }
        } catch (error: any) {
          import('../lib/logger').then(({ default: logger }) => logger.warn('Gemini failed for business personas, trying DeepSeek', { search_id: search.id, error: error?.message })).catch(()=>{});
        }
      }

      if (!personas.length) {
        try {
          // 3) DeepSeek final fallback
          const text = await callDeepseekChatJSON({ 
            user: improvedPrompt + '\nReturn ONLY JSON: {"personas": [ ... ] }', 
            temperature: 0.3, 
            maxTokens: 1200, 
            timeoutMs: 20000, 
            retries: 1 
          });
          const arr = tryParsePersonas(text);
          const accepted = acceptPersonas((arr || []).slice(0, 3));
          if (accepted.length === 3) {
            personas = accepted;
            import('../lib/logger').then(({ default: logger }) => logger.info('Business personas generated with DeepSeek', { search_id: search.id })).catch(()=>{});
          }
        } catch (error: any) {
          import('../lib/logger').then(({ default: logger }) => logger.error('All LLM fallbacks failed for business personas', { search_id: search.id, error: error?.message })).catch(()=>{});
        }
      }
    }

    if (personas.length === 3 && hasGenericTitles(personas)) {
      try {
        const refinePrompt = `Your previous titles were too generic or duplicated. Rewrite ONLY the titles to be highly descriptive, unique company archetypes directly tied to ${search.product_service} and the ${search.search_type==='customer'?'buying/usage':'selling/provision'} lens in ${search.countries.join(', ')}.
Return JSON: {"personas": [ {"title": "..."}, {"title": "..."}, {"title": "..."} ] }`;
        const text = await callOpenAIChatJSON({
          model: resolveModel('light'),
          system: 'Return ONLY JSON with updated titles as instructed.',
          user: refinePrompt,
          temperature: 0.3,
          maxTokens: 200,
          requireJsonObject: true,
          verbosity: 'low'
        });
        const obj = JSON.parse(text || '{}');
        const newTitles = Array.isArray(obj?.personas) ? obj.personas.map((x:any)=>x?.title).filter(Boolean) : [];
        if (newTitles.length === 3) {
          personas = personas.map((p, i) => ({ ...p, title: String(newTitles[i]) }));
        }
      } catch {}
    }
    if (personas.length === 3) {
      personas = await ensureUniqueTitles<Persona>(personas, { id: search.id });
    }

    if (personas.length) {
      const validated = personas
        .map(p => validateMarketPotential(p, search.id))
        .filter((p): p is Persona => Boolean(p));
      personas = validated;
    }

    if (personas.length) {
      const sanitized = personas.slice(0, 3).map((p: Persona, i: number) => sanitizePersona('business', p, i, search as any));
      const rows = sanitized.map((p: Persona) => ({
        search_id: search.id,
        user_id: search.user_id,
        title: p.title,
        rank: p.rank,
        match_score: p.match_score,
        demographics: p.demographics || {},
        characteristics: p.characteristics || {},
        behaviors: p.behaviors || {},
        market_potential: p.market_potential || {},
        locations: p.locations || []
      }));
      await insertPersonaCache(cacheKey, sanitized);
      await insertBusinessPersonas(rows);
      await updateSearchProgress(search.id, 10, 'business_personas');
      import('../lib/logger').then(({ default: logger }) => logger.info('Completed business persona generation', { search_id: search.id })).catch(()=>{});
      
      // Trigger business-persona remapping after persona generation
      try {
        const { intelligentPersonaMapping } = await import('../tools/persona-mapper');
        void intelligentPersonaMapping(search.id).catch((err: any) =>
          import('../lib/logger').then(({ default: logger }) =>
            logger.warn('Post-generation persona remapping failed', { search_id: search.id, error: err?.message || err })
          ).catch(() => {})
        );
      } catch (error: any) {
        import('../lib/logger').then(({ default: logger }) =>
          logger.warn('Failed to trigger post-generation persona remapping', { search_id: search.id, error: error?.message || error })
        ).catch(() => {});
      }
      return;
    }

    if (!personas.length) {
      try {
        const quick = await callOpenAIChatJSON({
          model: resolveModel('ultraLight'),
          system: 'Return ONLY JSON: {"personas": [ ... ] } with exactly 3 complete persona objects.',
          user: improvedPrompt,
          temperature: 0.2,
          maxTokens: 650,
          requireJsonObject: true,
          verbosity: 'low',
          timeoutMs: 15000,
          retries: 0
        });
        const arr = tryParsePersonas(quick);
        const accepted = acceptPersonas((arr || []).slice(0, 3));
        if (accepted.length === 3) personas = accepted;
      } catch {}
      if (!personas.length) {
        import('../lib/logger').then(({ default: logger }) => logger.warn('[BusinessPersona] No personas returned by LLMs within time budget', { search_id: search.id })).catch(()=>{});
        return;
      }
    }
  } catch (error) {
    import('../lib/logger').then(({ default: logger }) => logger.error('Business persona generation failed', { search_id: search.id, error: (error as any)?.message || error })).catch(()=>{});
    throw error;
  }
}