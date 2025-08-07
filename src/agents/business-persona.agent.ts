import { Agent, tool, run } from '@openai/agents';
import { insertBusinessPersonas, updateSearchProgress, logApiUsage } from '../tools/db.write';
import { gemini } from './clients';

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
  description: 'Persist exactly 5 business personas for a search.',
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

    if (!Array.isArray(personas) || personas.length !== 5) {
      throw new Error('Expected exactly 5 personas.');
    }
    for (const p of personas) {
      for (const k of ['title','rank','match_score','demographics','characteristics','behaviors','market_potential','locations']) {
        if (!(k in p)) throw new Error(`persona missing key: ${k}`);
      }
    }

    const rows = personas.slice(0,5).map((p:Persona, idx:number)=>({
      id: `${search_id || 'persona'}-${idx+1}`,
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
  instructions: `Create exactly 5 business personas using the provided search criteria.

TASK: Call storeBusinessPersonas tool ONCE with all 5 personas. Each persona needs:
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
  handoffDescription: 'Generates 5 hyper-personalized business personas tailored to exact search criteria',
  handoffs: [],
  model: 'gpt-4o-mini'
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
    if (typeof persona.match_score !== 'number' || persona.match_score < 80) return false;
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
    await updateSearchProgress(search.id, 10, 'business_personas', 'in_progress');
    const startTime = Date.now();
    let attempt = 0;
    let personas: Persona[] = [];
    const maxRetries = 3;
    const improvedPrompt = `Generate 5 business personas for:
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
- Output as a JSON array of 5 persona objects with all required fields.`;
    // Try Gemini first
    try {
      const model = gemini.getGenerativeModel({ model: 'gemini-1.5-pro' });
      const res = await model.generateContent([{ text: improvedPrompt }]);
      const text = res.response.text().trim();
      const json = JSON.parse(text.match(/\[.*\]/s)?.[0] || '[]');
      if (Array.isArray(json) && json.length === 5 && json.every(isRealisticPersona)) {
        personas = json;
        const rows = personas.slice(0, 5).map((p: Persona, idx: number) => ({
          id: `${search.id}-gemini-${idx+1}`,
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
        await logApiUsage({
          user_id: search.user_id,
          search_id: search.id,
          provider: 'gemini',
          endpoint: 'business_personas',
          status: 200,
          ms: Date.now() - startTime,
          request: { model: 'gemini-1.5-pro' },
          response: { personas_generated: 5 }
        });
        await updateSearchProgress(search.id, 20, 'business_personas_completed');
        console.log(`Completed business persona generation for search ${search.id} (Gemini)`);
        return;
      }
    } catch (geminiError: any) {
      console.warn(`[BusinessPersona] Gemini failed:`, (geminiError as Error).message);
    }
    // Fallback to OpenAI (existing logic)
    while (attempt < maxRetries) {
      attempt++;
      try {
        console.log(`[BusinessPersona] Attempt ${attempt} for search ${search.id} (OpenAI fallback)`);
        await run(BusinessPersonaAgent, [{ role: 'user', content: improvedPrompt }]);
        break;
      } catch (error: any) {
        console.warn(`[BusinessPersona] Attempt ${attempt} failed:`, error.message);
        if (attempt >= maxRetries) {
          await logApiUsage({
            user_id: search.user_id,
            search_id: search.id,
            provider: 'deepseek',
            endpoint: 'business_personas',
            status: 500,
            ms: Date.now() - startTime,
            request: { search_type: search.search_type, industries: search.industries, countries: search.countries },
            response: { error: error.message, attempt }
          });
          throw error;
        }
      }
    }
    if (!personas.length) {
      console.error(`[BusinessPersona] All attempts failed for search ${search.id}. Inserting placeholder persona.`);
      const placeholder = [{
        id: `${search.id}-placeholder-1`,
        search_id: search.id,
        user_id: search.user_id,
        title: 'Persona Generation Failed',
        rank: 1,
        match_score: 0,
        demographics: { industry: 'N/A', companySize: 'N/A', geography: 'N/A', revenue: 'N/A' },
        characteristics: { painPoints: ['N/A'], motivations: ['N/A'], challenges: ['N/A'], decisionFactors: ['N/A'] },
        behaviors: { buyingProcess: 'N/A', decisionTimeline: 'N/A', budgetRange: 'N/A', preferredChannels: ['N/A'] },
        market_potential: { totalCompanies: 0, avgDealSize: 'N/A', conversionRate: 0 },
        locations: ['N/A']
      }];
      await insertBusinessPersonas(placeholder);
      await logApiUsage({
        user_id: search.user_id,
        search_id: search.id,
        provider: 'deepseek',
        endpoint: 'business_personas',
        status: 500,
        request: { error: 'All LLM attempts failed' },
        response: { placeholder: true }
      });
      await updateSearchProgress(search.id, 20, 'business_personas_completed');
    }
    await updateSearchProgress(search.id, 20, 'business_personas_completed');
    console.log(`Completed business persona generation for search ${search.id}`);
  } catch (error) {
    console.error(`Business persona generation failed for search ${search.id}:`, error);
    throw error;
  }
}