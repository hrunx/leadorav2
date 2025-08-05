import { Agent, tool, run } from '@openai/agents';
import { insertBusinessPersonas, updateSearchProgress, logApiUsage } from '../tools/db.write';

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
    // Runtime guard (defensive): ensures payload is usable even if model drifts
    const { search_id, user_id, personas } = input as {
      search_id: string;
      user_id: string;
      personas: any[];
    };

    if (!Array.isArray(personas) || personas.length !== 5) {
      throw new Error('Expected exactly 5 personas.');
    }
    for (const p of personas) {
      for (const k of ['title','rank','match_score','demographics','characteristics','behaviors','market_potential','locations']) {
        if (!(k in p)) throw new Error(`persona missing key: ${k}`);
      }
    }

    const rows = personas.slice(0,5).map((p:any)=>({
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
    return await insertBusinessPersonas(rows);
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
    const msg = `Generate 5 business personas for:
- search_id=${search.id}
- user_id=${search.user_id}
- product_service=${search.product_service}
- industries=${search.industries.join(', ')}
- countries=${search.countries.join(', ')}
- search_type=${search.search_type}
- lens=${search.search_type==='customer'?'companies that need':'companies that sell/provide'}

CRITICAL: Create personas that operate in ALL specified countries (${search.countries.join(', ')}) and ALL specified industries (${search.industries.join(', ')}). Each persona should be relevant to the exact product/service: "${search.product_service}".`;
    
    console.log(`Starting business persona generation for search ${search.id} | Industries: ${search.industries.join(', ')} | Countries: ${search.countries.join(', ')}`);
    
    try {
      await run(BusinessPersonaAgent, [{ role: 'user', content: msg }]);
      
      // Log successful API usage to DeepSeek
      await logApiUsage({
        user_id: search.user_id,
        search_id: search.id,
        provider: 'deepseek',
        endpoint: 'business_personas',
        status: 200,
        ms: Date.now() - startTime,
        request: { search_type: search.search_type, industries: search.industries, countries: search.countries },
        response: { personas_generated: 5 }
      });
      
    } catch (error: any) {
      // Log failed API usage
      await logApiUsage({
        user_id: search.user_id,
        search_id: search.id,
        provider: 'deepseek',
        endpoint: 'business_personas',
        status: 500,
        ms: Date.now() - startTime,
        request: { search_type: search.search_type, industries: search.industries, countries: search.countries },
        response: { error: error.message }
      });
      throw error;
    }
    
    await updateSearchProgress(search.id, 20, 'business_personas_completed');
    console.log(`Completed business persona generation for search ${search.id}`);
  } catch (error) {
    console.error(`Business persona generation failed for search ${search.id}:`, error);
    throw error;
  }
}