import { Agent, tool } from '@openai/agents';
import { insertBusinessPersonas } from '../tools/db.write';
import { resolveModel, callOpenAIChatJSON, callGeminiText, callDeepseekChatJSON } from './clients';
import { extractJson } from '../tools/json';

interface Persona {
  title: string;
  rank: number;
  match_score: number;
  demographics: {
    industry: string;
    companySize: string;
    geography: string;
    revenue: string;
  };
  characteristics: {
    painPoints: string[];
    motivations: string[];
    challenges: string[];
    decisionFactors: string[];
  };
  behaviors: {
    buyingProcess: string;
    decisionTimeline: string;
    budgetRange: string;
    preferredChannels: string[];
  };
  market_potential: {
    totalCompanies: number;
    avgDealSize: string;
    conversionRate: number;
  };
  locations: string[];
}

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
      for (const k of ['title','rank','match_score','demographics','characteristics','behaviors','market_potential','locations']) {
        if (!(k in p)) throw new Error(`persona missing key: ${k}`);
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
function isRealisticPersona(persona: Persona): boolean {
  // Check for non-empty, non-default, non-generic values in all required fields
  if (!persona) return false;
  const isNonEmptyString = (v: any) => typeof v === 'string' && v.trim() && !['unknown', 'n/a', 'default', 'none'].includes(v.trim().toLowerCase());
  const isNonEmptyArray = (v: any) => Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString);
  const isNonZeroNumber = (v: any) => typeof v === 'number' && v > 0;
  try {
    if (!isNonEmptyString(persona.title)) return false;
    if (typeof persona.rank !== 'number' || persona.rank < 1 || persona.rank > 5) return false;
    if (typeof persona.match_score !== 'number' || persona.match_score < 60) return false;
    const d = persona.demographics;
    if (!d || !isNonEmptyString(d.industry) || !isNonEmptyString(d.companySize) || !isNonEmptyString(d.geography) || !isNonEmptyString(d.revenue)) return false;
    const c = persona.characteristics;
    if (!c || !isNonEmptyArray(c.painPoints) || !isNonEmptyArray(c.motivations) || !isNonEmptyArray(c.challenges) || !isNonEmptyArray(c.decisionFactors)) return false;
    const b = persona.behaviors;
    if (!b || !isNonEmptyString(b.buyingProcess) || !isNonEmptyString(b.decisionTimeline) || !isNonEmptyString(b.budgetRange) || !isNonEmptyArray(b.preferredChannels)) return false;
    const m = persona.market_potential;
    if (!m || !isNonZeroNumber(m.totalCompanies) || !isNonEmptyString(m.avgDealSize) || !isNonZeroNumber(m.conversionRate)) return false;
    if (!isNonEmptyArray(persona.locations)) return false;
    return true;
  } catch {
    return false;
  }
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

    const sanitizePersona = (p: any, index: number): Persona => ({
      title: String(p?.title || `${search.search_type==='customer'?'Buyer':'Supplier'} Archetype ${index+1} - ${search.industries[0] || 'General'}`),
      rank: typeof p?.rank === 'number' ? p.rank : index + 1,
      match_score: typeof p?.match_score === 'number' ? p.match_score : 85,
      demographics: {
        industry: String(p?.demographics?.industry || (search.industries[0] || 'General')),
        companySize: String(p?.demographics?.companySize || ''),
        geography: String(p?.demographics?.geography || (search.countries[0] || 'Global')),
        revenue: String(p?.demographics?.revenue || '')
      },
      characteristics: {
        painPoints: Array.isArray(p?.characteristics?.painPoints) ? p.characteristics.painPoints : [],
        motivations: Array.isArray(p?.characteristics?.motivations) ? p.characteristics.motivations : [],
        challenges: Array.isArray(p?.characteristics?.challenges) ? p.characteristics.challenges : [],
        decisionFactors: Array.isArray(p?.characteristics?.decisionFactors) ? p.characteristics.decisionFactors : []
      },
      behaviors: {
        buyingProcess: String(p?.behaviors?.buyingProcess || ''),
        decisionTimeline: String(p?.behaviors?.decisionTimeline || ''),
        budgetRange: String(p?.behaviors?.budgetRange || ''),
        preferredChannels: Array.isArray(p?.behaviors?.preferredChannels) ? p.behaviors.preferredChannels : []
      },
      market_potential: {
        totalCompanies: typeof p?.market_potential?.totalCompanies === 'number' ? p.market_potential.totalCompanies : 0,
        avgDealSize: String(p?.market_potential?.avgDealSize || ''),
        conversionRate: typeof p?.market_potential?.conversionRate === 'number' ? p.market_potential.conversionRate : 0
      },
      locations: Array.isArray(p?.locations) ? p.locations : [search.countries[0] || 'Global']
    });

    const acceptPersonas = (arr: any[]): Persona[] => {
      const three = (arr || []).slice(0,3);
      if (three.length !== 3) return [];
      const sanitized = three.map((p, i) => sanitizePersona(p, i));
      return sanitized;
    };

    const hasGenericTitles = (arr: Persona[]): boolean => {
      const bad = ['persona', 'profile', 'archetype'];
      const titles = arr.map(p => (p.title || '').toLowerCase());
      const duplicates = new Set<string>();
      let dup = false;
      for (const t of titles) {
        if (duplicates.has(t)) { dup = true; break; }
        duplicates.add(t);
      }
      return titles.some(t => bad.some(b => t.includes(b))) || dup;
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

    if (personas.length) {
      // Validate realism before persisting to avoid low-quality data
      const allRealistic = personas.every(p => isRealisticPersona(p));
      if (!allRealistic) {
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
      await insertBusinessPersonas(rows);
    }
    // Ensure we only update progress once at the end of the routine
    import('../lib/logger').then(({ default: logger }) => logger.info('Completed business persona generation', { search_id: search.id })).catch(()=>{});
  } catch (error) {
    import('../lib/logger').then(({ default: logger }) => logger.error('Business persona generation failed', { search_id: search.id, error: (error as any)?.message || error })).catch(()=>{});
    throw error;
  }
}