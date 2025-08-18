import { Agent, tool } from '@openai/agents';
import { insertBusinessPersonas, updateSearchProgress, insertPersonaCache } from '../tools/db.write';
import { loadBusinesses } from '../tools/db.read';
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
  additionalProperties: false
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
        await updateSearchProgress(search.id, 10, 'business_personas');
        import('../lib/logger').then(({ default: logger }) => logger.info('Loaded business personas from cache', { search_id: search.id })).catch(()=>{});
        return;
      }
    }

    // Deterministic-first synthesis will run after helper is defined below

    // Helper: synthesize personas from discovered businesses (used for deterministic-first and fallback)
    const synthesizeFromBusinesses = async (): Promise<Persona[]> => {
      try {
        const businesses = await loadBusinesses(search.id);
        if (!Array.isArray(businesses) || businesses.length === 0) return [];
        const sample = businesses.slice(0, 50);
        const byIndustry: Record<string, any[]> = {};
        for (const b of sample) {
          const ind = String((b as any)?.industry || (search.industries[0] || 'General'));
          if (!byIndustry[ind]) byIndustry[ind] = [];
          byIndustry[ind].push(b);
        }
        const topIndustries = Object.entries(byIndustry)
          .sort((a,b)=>b[1].length - a[1].length)
          .slice(0,3)
          .map(([name, list])=>({ name, list }));
        // Ensure we have 3 buckets
        while (topIndustries.length < 3) topIndustries.push({ name: search.industries[0] || 'General', list: sample });
        const countryLabel = search.countries.join(', ') || 'Global';
        const citySet = new Set<string>();
        sample.forEach(b=>{ const c=(b as any)?.city; if (c) citySet.add(String(c)); });
        const locs = Array.from(citySet); if (locs.length === 0) locs.push(countryLabel);
        const mkPersona = (idx: number, bucket: { name: string; list: any[] }): Persona => {
          const totalCompanies = Math.max(bucket.list.length * 10, 50);
          const rank = idx + 1;
          const titleBase = search.search_type === 'customer'
            ? `${rank === 1 ? 'Enterprise' : rank === 2 ? 'Mid-Market' : 'SMB'} ${bucket.name} Adopters of ${search.product_service}`
            : `${rank === 1 ? 'Tier-1' : rank === 2 ? 'Regional' : 'Boutique'} Providers for ${search.product_service} in ${bucket.name}`;
          const geo = `${countryLabel}${locs.length ? ` (${locs.slice(0,3).join(', ')})` : ''}`;
          const avgDeal = rank === 1 ? '$500k-$2M' : rank === 2 ? '$150k-$500k' : '$25k-$150k';
          const conv = rank === 1 ? 8 : rank === 2 ? 12 : 18;
          const preferredChannels = rank === 1 ? ['Executive briefings','RFP/RFQ','Industry events']
            : rank === 2 ? ['Demos','Case studies','Email'] : ['Webinars','Inbound content','Live chat'];
          return {
            title: titleBase,
            rank,
            match_score: rank === 1 ? 92 : rank === 2 ? 86 : 80,
            demographics: {
              industry: bucket.name,
              companySize: rank === 1 ? '1000-5000+' : rank === 2 ? '200-1000' : '10-200',
              geography: geo,
              revenue: rank === 1 ? '$100M-$1B+' : rank === 2 ? '$20M-$100M' : '$1M-$20M'
            },
            characteristics: {
              painPoints: search.search_type === 'customer'
                ? ['Integration complexity','Legacy constraints','Cost of ownership']
                : ['Lead volume consistency','Pricing pressure','Competitive differentiation'],
              motivations: search.search_type === 'customer'
                ? ['ROI','Efficiency','Scalability']
                : ['Revenue growth','Win rate','Partnerships'],
              challenges: search.search_type === 'customer'
                ? ['Change management','Talent gaps','Security/compliance']
                : ['Brand visibility','Solution fit','Delivery capacity'],
              decisionFactors: search.search_type === 'customer'
                ? ['Total cost','Integration ease','Security','Time-to-value']
                : ['Case studies','Capabilities','Coverage','Pricing model']
            },
            behaviors: {
              buyingProcess: search.search_type === 'customer' ? 'Committee-based evaluation with pilot' : 'Solution packaging and RFP participation',
              decisionTimeline: rank === 1 ? '3-6 months' : rank === 2 ? '2-4 months' : '1-3 months',
              budgetRange: avgDeal,
              preferredChannels
            },
            market_potential: {
              totalCompanies,
              avgDealSize: avgDeal,
              conversionRate: conv
            },
            locations: locs.slice(0, 6)
          } as Persona;
        };
        const generated = topIndustries.slice(0,3).map((b, i) => mkPersona(i, b));
        return generated;
      } catch {
        return [];
      }
    };

    // Deterministic-first: if we already have discovered businesses, synthesize personas immediately
    try {
      const preSynth = await synthesizeFromBusinesses();
      if (preSynth && preSynth.length === 3) {
        const accepted = await ensureUniqueTitles<Persona>(preSynth, { id: search.id });
        const allRealistic = accepted.every(p => isRealisticPersona('business', p));
        const allValid = allRealistic && accepted.every(p => validatePersona(p));
        if (allValid) {
          const rows = accepted.map(p => ({
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
          await insertPersonaCache(cacheKey, accepted);
          await insertBusinessPersonas(rows);
          await updateSearchProgress(search.id, 10, 'business_personas');
          import('../lib/logger').then(({ default: logger }) => logger.info('[BusinessPersona] Used deterministic-first synthesis', { search_id: search.id })).catch(()=>{});
          return;
        }
      }
    } catch {}

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
      const three = (arr || []).slice(0, 3);
      if (three.length !== 3) return [];
      const sanitized = three.map((p, i) => sanitizePersona('business', p, i, search));
      const validated = sanitized
        .map(p => validateMarketPotential(p, search.id))
        .filter((p): p is Persona => p !== null);
      return validated.length === 3 ? validated : [];
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
      // 1) GPT-5 light for speed with timeout/retry
      const text = await callOpenAIChatJSON({
        model: resolveModel('light'),
        system: 'Return ONLY JSON: {"personas": [ ... ] } with exactly 3 complete persona objects.',
        user: improvedPrompt,
        temperature: 0.3,
        maxTokens: 1200,
        requireJsonObject: true,
        verbosity: 'low',
        timeoutMs: 15000,
        retries: 1
      });
      const arr = tryParsePersonas(text);
      const accepted = acceptPersonas(arr);
      if (accepted.length === 3) personas = accepted;
    } catch {}
    if (!personas.length) {
      // 2) Gemini fallback
      try {
        const text = await callGeminiText('gemini-2.0-flash', improvedPrompt + '\nReturn ONLY JSON: {"personas": [ ... ] }', 15000, 1);
        const arr = tryParsePersonas(text);
        const accepted = acceptPersonas(arr);
        if (accepted.length === 3) personas = accepted;
      } catch {}
    }
    if (!personas.length) {
      // 3) DeepSeek fallback
      try {
        const text = await callDeepseekChatJSON({ user: improvedPrompt + '\nReturn ONLY JSON: {"personas": [ ... ] }', temperature: 0.4, maxTokens: 1200, timeoutMs: 15000, retries: 1 });
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
      await updateSearchProgress(search.id, 10, 'business_personas');
      import('../lib/logger').then(({ default: logger }) => logger.info('Completed business persona generation', { search_id: search.id })).catch(()=>{});
      return;
    }
    // Final fallback: synthesize from discovered businesses, then from context if still empty
    if (!personas.length) {
      const synthetic = await synthesizeFromBusinesses();
      let acceptedSynthetic = synthetic;
      if (acceptedSynthetic.length !== 3) {
        // Try pure context synthesis when no businesses yet
        const countryLabel = search.countries.join(', ') || 'Global';
        const industryLabel = (search.industries && search.industries[0]) || 'General';
        const mk = (rank: number): Persona => {
          const adopterTitle = rank === 1 ? 'Large Enterprise' : rank === 2 ? 'Mid-Market' : 'SMB';
          const providerTitle = rank === 1 ? 'Tier-1 Integrators' : rank === 2 ? 'Regional Specialists' : 'Boutique Providers';
          const title = search.search_type === 'customer'
            ? `${adopterTitle} ${industryLabel} Adopters of ${search.product_service}`
            : `${providerTitle} for ${search.product_service} in ${industryLabel}`;
          const avgDeal = rank === 1 ? '$500k-$2M' : rank === 2 ? '$150k-$500k' : '$25k-$150k';
          const conv = rank === 1 ? 8 : rank === 2 ? 12 : 18;
          const preferredChannels = rank === 1 ? ['Executive briefings','RFP/RFQ','Industry events']
            : rank === 2 ? ['Demos','Case studies','Email'] : ['Webinars','Inbound content','Live chat'];
          return {
            title,
            rank,
            match_score: rank === 1 ? 92 : rank === 2 ? 86 : 80,
            demographics: {
              industry: industryLabel,
              companySize: rank === 1 ? '1000-5000+' : rank === 2 ? '200-1000' : '10-200',
              geography: countryLabel,
              revenue: rank === 1 ? '$100M-$1B+' : rank === 2 ? '$20M-$100M' : '$1M-$20M'
            },
            characteristics: {
              painPoints: search.search_type === 'customer'
                ? ['Integration complexity','Legacy constraints','Cost of ownership']
                : ['Lead volume consistency','Pricing pressure','Competitive differentiation'],
              motivations: search.search_type === 'customer'
                ? ['ROI','Efficiency','Scalability']
                : ['Revenue growth','Win rate','Partnerships'],
              challenges: search.search_type === 'customer'
                ? ['Change management','Talent gaps','Security/compliance']
                : ['Brand visibility','Solution fit','Delivery capacity'],
              decisionFactors: search.search_type === 'customer'
                ? ['Total cost','Integration ease','Security','Time-to-value']
                : ['Case studies','Capabilities','Coverage','Pricing model']
            },
            behaviors: {
              buyingProcess: search.search_type === 'customer' ? 'Committee-based evaluation with pilot' : 'Solution packaging and RFP participation',
              decisionTimeline: rank === 1 ? '3-6 months' : rank === 2 ? '2-4 months' : '1-3 months',
              budgetRange: avgDeal,
              preferredChannels
            },
            market_potential: {
              totalCompanies: rank === 1 ? 500 : rank === 2 ? 2000 : 5000,
              avgDealSize: avgDeal,
              conversionRate: conv
            },
            locations: [countryLabel]
          } as Persona;
        };
        acceptedSynthetic = [mk(1), mk(2), mk(3)];
      }
      if (acceptedSynthetic.length === 3) {
        const unique = await ensureUniqueTitles<Persona>(acceptedSynthetic, { id: search.id });
        const sanitized = unique.map((p, i) => sanitizePersona('business', p, i, search));
        const realistic = sanitized.every(p => isRealisticPersona('business', p));
        const allValid = realistic && sanitized.every(p => validatePersona(p));
        if (allValid) {
          const rows = sanitized.map(p => ({
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
          import('../lib/logger').then(({ default: logger }) => logger.warn('[BusinessPersona] Used heuristic fallback from businesses', { search_id: search.id })).catch(()=>{});
          return;
        }
      }
      // If persona synthesis still fails, log and exit without throwing to avoid orchestrator crash
      import('../lib/logger')
        .then(({ default: logger }) => logger.error('[BusinessPersona] Failed to synthesize fallback personas', { search_id: search.id }))
        .catch(() => {});
      return;
    }
  } catch (error) {
    import('../lib/logger').then(({ default: logger }) => logger.error('Business persona generation failed', { search_id: search.id, error: (error as any)?.message || error })).catch(()=>{});
    throw error;
  }
}