import { Agent, tool } from '@openai/agents';
import { insertDMPersonas, updateSearchProgress } from '../tools/db.write';
import { resolveModel, callOpenAIChatJSON, callGeminiText, callDeepseekChatJSON } from './clients';
import { extractJson } from '../tools/json';

import { sanitizePersona, isRealisticPersona, DMPersona } from '../tools/persona-validation';

import Ajv from 'ajv';

interface LocalDMPersona {
  title: string;
  rank: number;
  match_score: number;
  demographics: {
    level: string;
    department: string;
    experience: string;
    geography: string;
  };
  characteristics: {
    responsibilities: string[];
    painPoints: string[];
    motivations: string[];
    challenges: string[];
    decisionFactors: string[];
  };
  behaviors: {
    decisionMaking: string;
    communicationStyle: string;
    buyingProcess: string;
    preferredChannels: string[];
  };
  market_potential: {
    totalDecisionMakers: number;
    avgInfluence: number;
    conversionRate: number;
  };
}

interface StoreDMPersonasToolInput {
  search_id: string;
  user_id: string;
  personas: DMPersona[];
}

const ajv = new Ajv({ allErrors: true });

// Relaxed validation: only require core fields; other objects optional and open
const dmPersonaSchema: any = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    rank: { type: 'integer' },
    match_score: { type: 'integer' },
    demographics: { type: 'object', additionalProperties: true },
    characteristics: { type: 'object', additionalProperties: true },
    behaviors: { type: 'object', additionalProperties: true },
    market_potential: { type: 'object', additionalProperties: true }
  },
  required: ['title','rank','match_score'],
  additionalProperties: false
};

const validateDMPersona = ajv.compile(dmPersonaSchema);

const storeDMPersonasTool = tool({
  name: 'storeDMPersonas',
  description: 'Persist exactly 3 decision-maker personas for a search.',
  parameters: {
    type: 'object',
    properties: {
      search_id: { type: 'string' },
      user_id: { type: 'string' },
      personas: {
        type: 'array', minItems: 1, maxItems: 5,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            rank: { type: 'integer' },
            match_score: { type: 'integer' },
            demographics: { type: 'object', additionalProperties: true },
            characteristics: { type: 'object', additionalProperties: true },
            behaviors: { type: 'object', additionalProperties: true },
            market_potential: { type: 'object', additionalProperties: true }
          },
          required: ['title','rank','match_score'],
          additionalProperties: false
        }
      }
    },
    required: ['search_id','user_id','personas'],
    additionalProperties: false
  } as const,
  strict: true,
  execute: async (input: unknown) => {
    const { search_id, user_id, personas } = input as StoreDMPersonasToolInput;
    if (!Array.isArray(personas) || personas.length !== 3) {
      throw new Error('Expected exactly 3 personas.');
    }
    for (const p of personas) {
      if (!validateDMPersona(p)) {
        import('../lib/logger')
          .then(({ default: logger }) =>
            logger.error('DM persona validation failed', { errors: validateDMPersona.errors, persona: p })
          )
          .catch(() => {});
        throw new Error('Invalid DM persona structure.');
      }
    }
    const rows = personas.slice(0,3).map((p: LocalDMPersona) => ({
      search_id,
      user_id,
      title: p.title,
      rank: p.rank,
      match_score: p.match_score,
      demographics: p.demographics || {},
      characteristics: p.characteristics || {},
      behaviors: p.behaviors || {},
      market_potential: p.market_potential || {}
    }));
    return await insertDMPersonas(rows);
  }
});

export const DMPersonaAgent = new Agent({
  name: 'DMPersonaAgent',
  tools: [storeDMPersonasTool],
  handoffDescription: 'Generates 3 decision maker personas for a search context',
  handoffs: [],
  // Use primary GPT-5 for better persona quality
  model: resolveModel('primary'),

  instructions: `Create exactly 3 decision maker personas using the provided search criteria.

  TASK: Call storeDMPersonas tool ONCE with all 3 personas. Each persona needs:
- title: Role title for the specific industry/country
- rank: 1-5 (1 = highest decision authority)  
- match_score: 80-100
- demographics: {level, department, experience, geography}
- characteristics: {responsibilities, painPoints, motivations, challenges, decisionFactors}
- behaviors: {decisionMaking, communicationStyle, buyingProcess, preferredChannels}
- market_potential: {totalDecisionMakers, avgInfluence, conversionRate}

Use EXACT search criteria provided. Create personas who would make purchasing decisions for the specified product/service in the target country/industry.

CRITICAL: Call storeDMPersonas tool ONCE with complete data. Do not retry.`
});

export async function runDMPersonas(search: {
  id:string; 
  user_id:string; 
  product_service:string; 
  industries:string[]; 
  countries:string[];
  search_type:'customer'|'supplier';
}) {
  try {
    let personas: LocalDMPersona[] = [];
    let rejectedPersonas: LocalDMPersona[] = [];
    const improvedPrompt = `Generate 3 decision-maker personas for:
- search_id=${search.id}
- user_id=${search.user_id}
- product_service=${search.product_service}
- industries=${search.industries.join(', ')}
- countries=${search.countries.join(', ')}
- search_type=${search.search_type}
- lens=${search.search_type==='customer'?'buyers/implementers':'category owners / category managers / sales leaders'}

CRITICAL: Each persona must have:
- Realistic, non-generic, non-empty values for every field. No 'Unknown', 'N/A', or placeholders.
- Arrays must contain at least 3 items: responsibilities, painPoints, motivations, challenges, decisionFactors, preferredChannels.
- Numbers must be positive: totalDecisionMakers (> 0), avgInfluence (50-100), conversionRate (1-25), match_score (70-100).
- Titles must be specific to ${search.product_service} for ${search.industries.join(', ')} in ${search.countries.join(', ')}; avoid generic-only titles.
- Provide role-relevant, concrete list items (avoid ['Budget','Time']).

Return ONLY JSON: {"personas": [ ...exactly 3 persona objects... ]}.`;
    // Sequential fallback: GPT -> Gemini -> DeepSeek, with JSON extraction and sanitization
    const tryParsePersonas = (text: string): any[] => {
      try {
        const obj = JSON.parse(text || '{}');
        if (Array.isArray((obj as any)?.personas)) return (obj as any).personas as any[];
        if (Array.isArray((obj as any))) return obj as any[];
        // Sometimes models return an object with numbered keys
        const vals = Object.values(obj || {});
        if (vals.length && vals.every(v => typeof v === 'object')) return vals as any[];
        return [];
      } catch {
        const ex = extractJson(text);
        try {
          const obj = typeof ex === 'string' ? JSON.parse(ex) : ex;
          if (Array.isArray((obj as any)?.personas)) return (obj as any).personas as any[];
          if (Array.isArray((obj as any))) return obj as any[];
          const vals = Object.values(obj || {});
          if (vals.length && vals.every(v => typeof v === 'object')) return vals as any[];
          return [];
        } catch { return []; }
      }
    };

    const acceptPersonas = (arr: any[]): LocalDMPersona[] => {
      const three = (arr || []).slice(0,3);
      if (three.length !== 3) return [];
      // sanitize and coerce types/arrays; also compute match_score heuristics if 0
      const out = three.map((p, i) => sanitizePersona('dm', p, i, search) as any);
      return out as LocalDMPersona[];
    };

    // One-pass repair to fill missing/empty lists and enforce numeric ranges (LLM-only)
    const repairPersonas = async (arr: LocalDMPersona[]): Promise<LocalDMPersona[]> => {
      const prompt = `Repair these 3 decision-maker personas so they fully satisfy the schema and constraints. 
Keep titles and essence, but fill any missing fields and ensure arrays have at least 3 concrete items, and numeric ranges are valid.
Context: product_service=${search.product_service}; industries=${search.industries.join(', ')}; countries=${search.countries.join(', ')}.
Return ONLY JSON: {"personas": [ ...3 items... ]}
Personas: ${JSON.stringify(arr)}`;
      // Try GPT-5 then Gemini then DeepSeek
      try {
        const text = await callOpenAIChatJSON({
          model: resolveModel('primary'),
          system: 'You output ONLY valid JSON object {"personas": [...]} with exactly 3 items.',
          user: prompt,
          temperature: 0.2,
          maxTokens: 1200,
          requireJsonObject: true,
          timeoutMs: 15000,
          retries: 1,
        });
        const accepted = acceptPersonas(tryParsePersonas(text));
        if (accepted.length === 3) return accepted;
      } catch {}
      try {
        const text = await callGeminiText('gemini-2.0-flash', prompt, 15000, 1);
        const accepted = acceptPersonas(tryParsePersonas(text));
        if (accepted.length === 3) return accepted;
      } catch {}
      try {
        const text = await callDeepseekChatJSON({ user: prompt, temperature: 0.3, maxTokens: 1200, timeoutMs: 15000, retries: 0 });
        const accepted = acceptPersonas(tryParsePersonas(text));
        if (accepted.length === 3) return accepted;
      } catch {}
      return arr;
    };

    const ensureProductServiceKeywords = async (arr: LocalDMPersona[]): Promise<LocalDMPersona[]> => {
      const keywords = String(search.product_service || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter(Boolean);
      const needsRefine = arr.some(p => {
        const text = [...p.characteristics.responsibilities, ...p.characteristics.decisionFactors]
          .join(' ')
          .toLowerCase();
        return !keywords.some(k => text.includes(k));
      });
      if (!needsRefine) return arr;
      const prompt = `Refine the personas so each includes at least one of the keywords (${keywords.join(', ')}) in responsibilities or decision factors. Keep all other fields intact. Personas: ${JSON.stringify(arr)}`;
      try {
        const text = await callOpenAIChatJSON({
          model: resolveModel('primary'),
          system: 'Return ONLY JSON: {"personas": [ ... ] } with exactly 3 complete decision-maker persona objects.',
          user: prompt,
          temperature: 0.4,
          maxTokens: 800,
          requireJsonObject: true,
          verbosity: 'low'
        });
        const refined = acceptPersonas(tryParsePersonas(text));
        return refined.length === 3 ? refined : arr;
      } catch {
        return arr;
      }
    };

    const isNonEmptyString = (v: any): v is string => typeof v === 'string' && v.trim().length > 0;
    const isNonEmptyStringArray = (arr: any): arr is string[] => Array.isArray(arr) && arr.length > 0 && arr.every(isNonEmptyString);
    const validatePersona = (p: LocalDMPersona): boolean =>
      isNonEmptyString(p.title) &&
      isNonEmptyString(p.demographics.level) &&
      isNonEmptyString(p.demographics.department) &&
      isNonEmptyString(p.demographics.experience) &&
      isNonEmptyString(p.demographics.geography) &&
      isNonEmptyStringArray(p.characteristics.responsibilities) &&
      isNonEmptyStringArray(p.characteristics.painPoints) &&
      isNonEmptyStringArray(p.characteristics.motivations) &&
      isNonEmptyStringArray(p.characteristics.challenges) &&
      isNonEmptyStringArray(p.characteristics.decisionFactors) &&
      isNonEmptyString(p.behaviors.decisionMaking) &&
      isNonEmptyString(p.behaviors.communicationStyle) &&
      isNonEmptyString(p.behaviors.buyingProcess) &&
      isNonEmptyStringArray(p.behaviors.preferredChannels) &&
      // Require meaningful score after sanitization
      typeof p.match_score === 'number' && p.match_score >= 65;
    const validatePersonas = (arr: LocalDMPersona[]) => {
      const valid: LocalDMPersona[] = [];
      const rejected: LocalDMPersona[] = [];
      arr.forEach(p => (validatePersona(p) ? valid : rejected).push(p));
      return { valid, rejected };
    };

    try {
      // 1) GPT-4o-mini primary
      const text = await callOpenAIChatJSON({
        model: resolveModel('primary'),
        system: 'Return ONLY JSON: {"personas": [ ... ] } with exactly 3 complete decision-maker persona objects.',
        user: improvedPrompt,
        temperature: 0.3,
        maxTokens: 1400,
        requireJsonObject: true,
        timeoutMs: 20000,
        retries: 1,
      });

      const accepted = acceptPersonas(tryParsePersonas(text));
      let { valid, rejected } = validatePersonas(accepted);
      if (valid.length !== 3) {
        const repaired = await repairPersonas(accepted);
        const v2 = validatePersonas(repaired);
        valid = v2.valid; rejected.push(...v2.rejected);
      }
      if (rejected.length) rejectedPersonas.push(...rejected);
      if (valid.length === 3) {
        personas = await ensureProductServiceKeywords(valid);
        import('../lib/logger').then(({ default: logger }) => logger.info('DM personas generated with GPT-4o-mini', { search_id: search.id })).catch(()=>{});
      }

    } catch (error: any) {
      import('../lib/logger').then(({ default: logger }) => logger.warn('GPT-4o-mini failed for DM personas, trying Gemini', { search_id: search.id, error: error?.message })).catch(()=>{});
    }
    if (!personas.length) {
      // 2) Gemini fallback
      try {
        const text = await callGeminiText('gemini-2.0-flash-exp', improvedPrompt + '\nReturn ONLY JSON: {"personas": [ ... ] }', 20000, 1);

        const accepted = acceptPersonas(tryParsePersonas(text));
        let { valid, rejected } = validatePersonas(accepted);
        if (valid.length !== 3) {
          const repaired = await repairPersonas(accepted);
          const v2 = validatePersonas(repaired);
          valid = v2.valid; rejected.push(...v2.rejected);
        }
        if (rejected.length) rejectedPersonas.push(...rejected);
        if (valid.length === 3) {
          personas = await ensureProductServiceKeywords(valid);
          import('../lib/logger').then(({ default: logger }) => logger.info('DM personas generated with Gemini', { search_id: search.id })).catch(()=>{});
        }

      } catch (error: any) {
        import('../lib/logger').then(({ default: logger }) => logger.warn('Gemini failed for DM personas, trying DeepSeek', { search_id: search.id, error: error?.message })).catch(()=>{});
      }
    }
    if (!personas.length) {
      // 3) DeepSeek fallback
      try {
        const text = await callDeepseekChatJSON({ user: improvedPrompt + '\nReturn ONLY JSON: {"personas": [ ... ] }', temperature: 0.3, maxTokens: 1500, timeoutMs: 20000, retries: 1 });

        const accepted = acceptPersonas(tryParsePersonas(text));
        let { valid, rejected } = validatePersonas(accepted);
        if (valid.length !== 3) {
          const repaired = await repairPersonas(accepted);
          const v2 = validatePersonas(repaired);
          valid = v2.valid; rejected.push(...v2.rejected);
        }
        if (rejected.length) rejectedPersonas.push(...rejected);
        if (valid.length === 3) {
          personas = await ensureProductServiceKeywords(valid);
          import('../lib/logger').then(({ default: logger }) => logger.info('DM personas generated with DeepSeek', { search_id: search.id })).catch(()=>{});
        }
      } catch (error: any) {
        import('../lib/logger').then(({ default: logger }) => logger.error('All LLM fallbacks failed for DM personas', { search_id: search.id, error: error?.message })).catch(()=>{});
      }
    }

    if (rejectedPersonas.length) {
      import('../lib/logger')
        .then(({ default: logger }) =>
          logger.warn('Rejected DM personas', { search_id: search.id, personas: rejectedPersonas })
        )
        .catch(() => {});
    }

    if (personas.length === 3) {
      const allRealistic = personas.every(p => isRealisticPersona('dm', p as any));
      if (!allRealistic) personas = [];
    }
    if (personas.length === 3) {
      const allValid = personas.every(p => validateDMPersona(p));
      if (!allValid) {
        import('../lib/logger')
          .then(({ default: logger }) =>
            logger.error('DM persona schema validation failed', { errors: validateDMPersona.errors })
          )
          .catch(() => {});
        personas = [];
      }
    }
    if (personas.length === 3) {
      const rows = personas.map((p: LocalDMPersona) => ({
        search_id: search.id,
        user_id: search.user_id,
        title: p.title,
        rank: p.rank,
        match_score: p.match_score,
        demographics: p.demographics ? { 
          ...p.demographics,
          // fix duplicated department like "Technology Technology"
          department: String(p.demographics.department || '').replace(/\b(\w+)\s+\1\b/i, '$1')
        } : {},
        characteristics: p.characteristics || {},
        behaviors: p.behaviors || {},
        market_potential: p.market_potential || {}
      }));
      await insertDMPersonas(rows);
      await updateSearchProgress(search.id, 10, 'dm_personas');
      import('../lib/logger')
        .then(({ default: logger }) =>
          logger.info('Completed DM persona generation', { search_id: search.id })
        )
        .catch(() => {});
      return;
    }
    // All LLMs failed; do not insert any personas. Log and exit.
    import('../lib/logger')
      .then(({ default: logger }) => logger.error('[DMPersona] All LLMs failed with strict validation; no personas inserted', { search_id: search.id }))
      .catch(() => {});
  } catch (error) {
  import('../lib/logger').then(({ default: logger }) => logger.error('DM persona generation failed', { search_id: search.id, error: (error as any)?.message || error })).catch(()=>{});
    throw error;
  }
}