import { Agent, tool, run } from '@openai/agents';
import { insertDMPersonas, updateSearchProgress } from '../tools/db.write';

const storeDMPersonasTool = tool({
  name: 'storeDMPersonas',
  description: 'Persist exactly 5 decision-maker personas for a search.',
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
                level: { type: 'string' },
                department: { type: 'string' },
                experience: { type: 'string' },
                geography: { type: 'string' }
              },
              required: ['level', 'department', 'experience', 'geography'],
              additionalProperties: false 
            },
            characteristics: { 
              type: 'object',
              properties: {
                responsibilities: { type: 'array', items: { type: 'string' } },
                painPoints: { type: 'array', items: { type: 'string' } },
                motivations: { type: 'array', items: { type: 'string' } },
                challenges: { type: 'array', items: { type: 'string' } },
                decisionFactors: { type: 'array', items: { type: 'string' } }
              },
              required: ['responsibilities', 'painPoints', 'motivations', 'challenges', 'decisionFactors'],
              additionalProperties: false 
            },
            behaviors: { 
              type: 'object',
              properties: {
                decisionMaking: { type: 'string' },
                communicationStyle: { type: 'string' },
                buyingProcess: { type: 'string' },
                preferredChannels: { type: 'array', items: { type: 'string' } }
              },
              required: ['decisionMaking', 'communicationStyle', 'buyingProcess', 'preferredChannels'],
              additionalProperties: false 
            },
            market_potential: { 
              type: 'object',
              properties: {
                totalDecisionMakers: { type: 'number' },
                avgInfluence: { type: 'number' },
                conversionRate: { type: 'number' }
              },
              required: ['totalDecisionMakers', 'avgInfluence', 'conversionRate'],
              additionalProperties: false 
            }
          },
          required: [
            'title',
            'rank',
            'match_score',
            'demographics',
            'characteristics',
            'behaviors',
            'market_potential'
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
      for (const k of ['title','rank','match_score','demographics','characteristics','behaviors','market_potential']) {
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
      market_potential:p.market_potential||{}
    }));
    return await insertDMPersonas(rows);
  }
});

export const DMPersonaAgent = new Agent({
  name: 'DMPersonaAgent',
  tools: [storeDMPersonasTool],
  handoffDescription: 'Generates 5 decision maker personas for a search context',
  handoffs: [],
  model: 'gpt-4o-mini',

  instructions: `Create exactly 5 decision maker personas using the provided search criteria.

TASK: Call storeDMPersonas tool ONCE with all 5 personas. Each persona needs:
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
    await updateSearchProgress(search.id, 10, 'dm_personas', 'in_progress');
    
    const msg = `Generate 5 decision-maker personas for:
- search_id=${search.id}
- product_service=${search.product_service}
- industries=${search.industries.join(', ')}
- countries=${search.countries.join(', ')}
- search_type=${search.search_type}
- lens=${search.search_type==='customer'?'buyers/implementers':'category owners / category managers / sales leaders'}

CRITICAL: Create personas representing decision makers across ALL specified countries (${search.countries.join(', ')}) and ALL specified industries (${search.industries.join(', ')}) who would be involved in decisions related to "${search.product_service}". Consider local business hierarchies and decision-making patterns in each region.`;
    
    console.log(`Starting DM persona generation for search ${search.id} | Industries: ${search.industries.join(', ')} | Countries: ${search.countries.join(', ')} | Product: ${search.product_service}`);
    
    await run(DMPersonaAgent, [{ role: 'user', content: msg }]);
    
    await updateSearchProgress(search.id, 20, 'dm_personas_completed');
    console.log(`Completed DM persona generation for search ${search.id}`);
  } catch (error) {
    console.error(`DM persona generation failed for search ${search.id}:`, error);
    throw error;
  }
}