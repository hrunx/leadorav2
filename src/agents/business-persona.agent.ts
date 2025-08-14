import { Agent, tool } from '@openai/agents';
import { insertBusinessPersonas, updateSearchProgress, insertPersonaCache } from '../tools/db.write';
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
import Ajv, { JSONSchemaType } from 'ajv';



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

const personaSchema: JSONSchemaType<Persona> = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    rank: { type: 'number' },
    match_score: { type: 'number' },
    demographics: {
      type: 'object',
      properties: {
        industry: { type: 'string' },
        companySize: { type: 'string' },
        geography: { type: 'string' },
        revenue: { type: 'string' }
      },
      required: ['industry', 'companySize', 'geography', 'revenue'],
      additionalProperties: false
    },
    characteristics: {
      type: 'object',
      properties: {
        painPoints: { type: 'array', items: { type: 'string' } },
        motivations: { type: 'array', items: { type: 'string' } },
        challenges: { type: 'array', items: { type: 'string' } },
        decisionFactors: { type: 'array', items: { type: 'string' } }
      },
      required: ['painPoints', 'motivations', 'challenges', 'decisionFactors'],
      additionalProperties: false
    },
    behaviors: {
      type: 'object',
      properties: {
        buyingProcess: { type: 'string' },
        decisionTimeline: { type: 'string' },
        budgetRange: { type: 'string' },
        preferredChannels: { type: 'array', items: { type: 'string' } }
      },
      required: ['buyingProcess', 'decisionTimeline', 'budgetRange', 'preferredChannels'],
      additionalProperties: false
    },
    market_potential: {
      type: 'object',
      properties: {
        totalCompanies: { type: 'number' },
        avgDealSize: { type: 'string' },
        conversionRate: { type: 'number' }
      },
      required: ['totalCompanies', 'avgDealSize', 'conversionRate'],
      additionalProperties: false
    },
    locations: { type: 'array', items: { type: 'string' } }
  },
  required: ['title', 'rank', 'match_score', 'demographics', 'characteristics', 'behaviors', 'market_potential', 'locations'],
  additionalProperties: false
};

const validatePersona = ajv.compile<Persona>(personaSchema);

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

        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            rank: { type: 'integer' },
            match_score: { type: 'integer' },
            demographics: { 
              type: 'object',
              properties: {
                industry: { type: 'string' },
                companySize: { type: 'string' },
                geography: { type: 'string' },
                revenue: { type: 'string' }
              },
              required: ['industry', 'companySize', 'geography', 'revenue'],
              additionalProperties: false 
            },
            characteristics: { 
              type: 'object',
              properties: {
                painPoints: { type: 'array', items: { type: 'string' } },
                motivations: { type: 'array', items: { type: 'string' } },
                challenges: { type: 'array', items: { type: 'string' } },
                decisionFactors: { type: 'array', items: { type: 'string' } }
              },
              required: ['painPoints', 'motivations', 'challenges', 'decisionFactors'],
              additionalProperties: false 
            },
            behaviors: { 
              type: 'object',
              properties: {
                buyingProcess: { type: 'string' },
                decisionTimeline: { type: 'string' },
                budgetRange: { type: 'string' },
                preferredChannels: { type: 'array', items: { type: 'string' } }
              },
              required: ['buyingProcess', 'decisionTimeline', 'budgetRange', 'preferredChannels'],
              additionalProperties: false 
            },
            market_potential: { 
              type: 'object',
              properties: {
                totalCompanies: { type: 'number' },
                avgDealSize: { type: 'string' },
                conversionRate: { type: 'number' }
              },
              required: ['totalCompanies', 'avgDealSize', 'conversionRate'],
              additionalProperties: false 
            },
            locations: { type: 'array', items: { type: 'string' } }
          },
          required: [
            'title',
            'rank',
            'match_score',
            'demographics',
            'characteristics',
            'behaviors',
            'market_potential',
            'locations'
          ],
          additionalProperties: false
        }
      }
    },
    required: ['search_id', 'user_id', 'personas'],
    additionalProperties: false
  } as const,
  execute: async (input: unknown) => {
    const { search_id, user_id, personas } = input as StoreBusinessPersonasToolInput;

    if (!Array.isArray(personas) || personas.length !== 3) {
      throw new Error('Expected exactly 3 personas.');
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
  model: resolveModel('primary')
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
        await updateSearchProgress(search.id, 20, 'business_personas');
        import('../lib/logger').then(({ default: logger }) => logger.info('Loaded business personas from cache', { search_id: search.id })).catch(()=>{});
        return;
      }
    }

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
- No field may be 'Unknown', 'N/A', 'Default', or empty.
- Use plausible company types, sizes, geographies, revenues, pain points, motivations, challenges, decision factors, buying processes, timelines, budget ranges, preferred channels, market potential, and locations for the given industry/country/product.
- If you cannot fill a field, infer a plausible value based on industry/country context.
- Do not repeat personas. Each must be unique and relevant.
 - Titles MUST be descriptive company archetypes tied to the product_service and lens.
   Examples (do not reuse literally): "Large Enterprise Energy Buyers (Utilities)", "Mid-Market Oilfield Services Providers", "Renewable EPC Contractors".
 - Titles MUST NOT be generic like 'Persona 1' or 'Profile'.
 - Ensure titles reflect ${search.search_type==='customer'?'needing/using':'selling/providing'} ${search.product_service} in ${search.countries.join(', ')}.
 - Return ONLY JSON: {"personas": [ ...exactly 3 items... ] }`;

    // Sequential fallback: GPT -> Gemini -> DeepSeek
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
      const three = (arr || []).slice(0,3);
      if (three.length !== 3) return [];
      return three.map((p, i) => sanitizePersona('business', p, i, search));
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

    try {
      // 1) GPT-5 primary
      const text = await callOpenAIChatJSON({
        model: resolveModel('primary'),
        system: 'Return ONLY JSON: {"personas": [ ... ] } with exactly 3 complete persona objects.',
        user: improvedPrompt,
        temperature: 0.3,
        maxTokens: 1400,
        requireJsonObject: true,
        verbosity: 'low'
      });
      const arr = tryParsePersonas(text);
      const accepted = acceptPersonas(arr);
      if (accepted.length === 3) personas = accepted;
    } catch {}
    if (!personas.length) {
      // 2) Gemini fallback
      try {
        const text = await callGeminiText('gemini-2.0-flash', improvedPrompt + '\nReturn ONLY JSON: {"personas": [ ... ] }');
        const arr = tryParsePersonas(text);
        const accepted = acceptPersonas(arr);
        if (accepted.length === 3) personas = accepted;
      } catch {}
    }
    if (!personas.length) {
      // 3) DeepSeek fallback
      try {
        const text = await callDeepseekChatJSON({ user: improvedPrompt + '\nReturn ONLY JSON: {"personas": [ ... ] }', temperature: 0.4, maxTokens: 1200 });
        const arr = tryParsePersonas(text);
        const accepted = acceptPersonas(arr);
        if (accepted.length === 3) personas = accepted;
      } catch {}
    }

    // If we got personas but titles are generic or duplicated, force a refinement pass with stricter instructions
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
      // Schema validation for market potential figures
      const validated = personas
        .map(p => validateMarketPotential(p, search.id))
        .filter((p): p is Persona => Boolean(p));
      if (validated.length !== personas.length) {
        import('../lib/logger')
          .then(({ default: logger }) =>
            logger.error('[BusinessPersona] Persona count changed after validation', {
              search_id: search.id,
              before: personas.length,
              after: validated.length
            })
          )
          .catch(() => {});
      }
      personas = validated.length === 3 ? validated : [];
    }

    if (personas.length) {
      // Validate realism before persisting to avoid low-quality data
      const allRealistic = personas.every(p => isRealisticPersona('business', p));
      if (!allRealistic) {
        personas = [];
      }
    }
    if (personas.length) {
      const allValid = personas.every(p => validatePersona(p));
      if (!allValid) {
        import('../lib/logger')
          .then(({ default: logger }) => logger.error('Business persona schema validation failed', { errors: validatePersona.errors }))
          .catch(() => {});
        personas = [];
      }
    }

    if (personas.length) {
      const rows = personas.slice(0, 3).map((p: Persona) => ({
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
      await insertPersonaCache(cacheKey, personas);
      await insertBusinessPersonas(rows);
      import('../lib/logger').then(({ default: logger }) => logger.info('Completed business persona generation', { search_id: search.id })).catch(()=>{});
      return;
    }
    if (!personas.length) {
      import('../lib/logger').then(({ default: logger }) => logger.error('[BusinessPersona] All attempts failed, inserting deterministic personas', { search_id: search.id })).catch(()=>{});
      const [industryA] = search.industries.length ? search.industries : ['General'];
      const [countryA] = search.countries.length ? search.countries : ['Global'];
      const fallback: Persona[] = [
        {
          title: `Enterprise ${industryA} ${search.search_type === 'customer' ? 'Buyer' : 'Supplier'}`,
          rank: 1,
          match_score: 90,
          demographics: { industry: industryA, companySize: '1000-5000', geography: countryA, revenue: '$100M-$1B' },
          characteristics: { painPoints: ['Scale', 'Integration'], motivations: ['Efficiency','Growth'], challenges: ['Budget','Legacy'], decisionFactors: ['ROI','Support'] },
          behaviors: { buyingProcess: 'Committee', decisionTimeline: '6-12 months', budgetRange: '$500K-$2M', preferredChannels: ['Direct','Analyst'] },
          market_potential: { totalCompanies: 1000, avgDealSize: '$850K', conversionRate: 12 },
          locations: [countryA]
        },
        {
          title: `Mid-Market ${industryA} ${search.search_type === 'customer' ? 'Buyer' : 'Provider'}`,
          rank: 2,
          match_score: 85,
          demographics: { industry: industryA, companySize: '200-1000', geography: countryA, revenue: '$20M-$100M' },
          characteristics: { painPoints: ['Resources','Automation'], motivations: ['Growth','Speed'], challenges: ['Skills','Time'], decisionFactors: ['Cost','Scalability'] },
          behaviors: { buyingProcess: 'Streamlined', decisionTimeline: '3-6 months', budgetRange: '$100K-$500K', preferredChannels: ['Webinars','Partner'] },
          market_potential: { totalCompanies: 3500, avgDealSize: '$250K', conversionRate: 18 },
          locations: [countryA]
        },
        {
          title: `SMB ${industryA} ${search.search_type === 'customer' ? 'Adopter' : 'Vendor'}`,
          rank: 3,
          match_score: 80,
          demographics: { industry: industryA, companySize: '10-200', geography: countryA, revenue: '$1M-$20M' },
          characteristics: { painPoints: ['Budget','Bandwidth'], motivations: ['Savings','Time'], challenges: ['Selection','Adoption'], decisionFactors: ['Ease','Price'] },
          behaviors: { buyingProcess: 'Owner-led', decisionTimeline: '1-3 months', budgetRange: '$10K-$100K', preferredChannels: ['Online','Trials'] },
          market_potential: { totalCompanies: 15000, avgDealSize: '$45K', conversionRate: 25 },
          locations: [countryA]
        }
      ];
      for (const p of fallback) {
        if (!validatePersona(p)) {
          import('../lib/logger')
            .then(({ default: logger }) => logger.error('Fallback business persona validation failed', { errors: validatePersona.errors, persona: p }))
            .catch(() => {});
          throw new Error('Invalid fallback business persona.');
        }
      }
      const rows = fallback.map((p: Persona) => ({
        search_id: search.id,
        user_id: search.user_id,
        title: p.title,
        rank: p.rank,
        match_score: p.match_score,
        demographics: p.demographics,
        characteristics: p.characteristics,
        behaviors: p.behaviors,
        market_potential: p.market_potential,
        locations: p.locations
      }));
      await insertPersonaCache(cacheKey, fallback);
      await insertBusinessPersonas(rows);
    }
    // Ensure we only update progress once at the end of the routine
    import('../lib/logger').then(({ default: logger }) => logger.info('Completed business persona generation', { search_id: search.id })).catch(()=>{});
  } catch (error) {
    import('../lib/logger').then(({ default: logger }) => logger.error('Business persona generation failed', { search_id: search.id, error: (error as any)?.message || error })).catch(()=>{});
    throw error;
  }
}