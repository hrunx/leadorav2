import { Agent, tool } from '@openai/agents';
import { insertDMPersonas, updateSearchProgress } from '../tools/db.write';
import { resolveModel, callOpenAIChatJSON, callGeminiText, callDeepseekChatJSON } from './clients';

interface DMPersona {
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

const storeDMPersonasTool = tool({
  name: 'storeDMPersonas',
  description: 'Persist exactly 3 decision-maker personas for a search.',
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
  strict: true,
  execute: async (input: unknown) => {
    const { search_id, user_id, personas } = input as StoreDMPersonasToolInput;
    if (!Array.isArray(personas) || personas.length !== 3) {
      throw new Error('Expected exactly 3 personas.');
    }
    for (const p of personas) {
      for (const k of ['title','rank','match_score','demographics','characteristics','behaviors','market_potential']) {
        if (!(k in p)) throw new Error(`persona missing key: ${k}`);
      }
    }
    const rows = personas.slice(0,3).map((p: DMPersona) => ({
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

// --- Helper: Validate DM persona realism ---
function isRealisticDMPersona(persona: DMPersona): boolean {
  if (!persona) return false;
  const isNonEmptyString = (v: any) => typeof v === 'string' && v.trim() && !['unknown', 'n/a', 'default', 'none'].includes(v.trim().toLowerCase());
  const isNonEmptyArray = (v: any) => Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString);
  const isNonZeroNumber = (v: any) => typeof v === 'number' && v > 0;
  try {
    if (!isNonEmptyString(persona.title)) return false;
    if (typeof persona.rank !== 'number' || persona.rank < 1 || persona.rank > 5) return false;
    if (typeof persona.match_score !== 'number' || persona.match_score < 80) return false;
    const d = persona.demographics;
    if (!d || !isNonEmptyString(d.level) || !isNonEmptyString(d.department) || !isNonEmptyString(d.experience) || !isNonEmptyString(d.geography)) return false;
    const c = persona.characteristics;
    if (!c || !isNonEmptyArray(c.responsibilities) || !isNonEmptyArray(c.painPoints) || !isNonEmptyArray(c.motivations) || !isNonEmptyArray(c.challenges) || !isNonEmptyArray(c.decisionFactors)) return false;
    const b = persona.behaviors;
    if (!b || !isNonEmptyString(b.decisionMaking) || !isNonEmptyString(b.communicationStyle) || !isNonEmptyString(b.buyingProcess) || !isNonEmptyArray(b.preferredChannels)) return false;
    const m = persona.market_potential;
    if (!m || !isNonZeroNumber(m.totalDecisionMakers) || !isNonZeroNumber(m.avgInfluence) || !isNonZeroNumber(m.conversionRate)) return false;
    return true;
  } catch {
    return false;
  }
}

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
    let personas: DMPersona[] = [];
    const improvedPrompt = `Generate 3 decision-maker personas for:
- search_id=${search.id}
- user_id=${search.user_id}
- product_service=${search.product_service}
- industries=${search.industries.join(', ')}
- countries=${search.countries.join(', ')}
- search_type=${search.search_type}
- lens=${search.search_type==='customer'?'buyers/implementers':'category owners / category managers / sales leaders'}

CRITICAL: Each persona must have:
- Realistic, industry-specific, non-generic, non-default, non-empty values for every field.
- No field may be 'Unknown', 'N/A', 'Default', or empty.
- Use plausible role titles, levels, departments, experience, geographies, responsibilities, pain points, motivations, challenges, decision factors, decision making, communication styles, buying processes, preferred channels, and market potential for the given industry/country/product.
- If you cannot fill a field, infer a plausible value based on industry/country context.
- Do not repeat personas. Each must be unique and relevant.
 - Output as a JSON array of 3 persona objects with all required fields.`;
    // Lightning-fast persona generation: race models and accept first valid
    const fastCall = async () => {
      const text = await callOpenAIChatJSON({
        model: resolveModel('ultraLight'),
        system: 'Return ONLY JSON: {"personas": [ ... ] } with exactly 3 complete decision-maker persona objects.',
        user: improvedPrompt,
        temperature: 0.4,
        maxTokens: 700,
        requireJsonObject: true,
        verbosity: 'low'
      });
      const obj = JSON.parse(text || '{}');
      const arr = Array.isArray(obj?.personas) ? obj.personas : [];
      if (arr.length === 3 && arr.every(isRealisticDMPersona)) return arr as DMPersona[];
      throw new Error('fast invalid');
    };
    const primaryCall = async () => {
      const text = await callOpenAIChatJSON({
        model: resolveModel('primary'),
        system: 'Return ONLY JSON: {"personas": [ ... ] } with exactly 3 complete decision-maker persona objects.',
        user: improvedPrompt,
        temperature: 0.4,
        maxTokens: 1200,
        requireJsonObject: true,
        verbosity: 'low'
      });
      const obj = JSON.parse(text || '{}');
      const arr = Array.isArray(obj?.personas) ? obj.personas : [];
      if (arr.length === 3 && arr.every(isRealisticDMPersona)) return arr as DMPersona[];
      throw new Error('primary invalid');
    };
    const geminiCall = async () => {
      const text = await callGeminiText('gemini-2.0-flash', improvedPrompt + '\nReturn ONLY JSON: {"personas": [ ... ] }');
      const obj = JSON.parse(text || '{}');
      const arr = Array.isArray((obj as any)?.personas) ? (obj as any).personas : [];
      if (arr.length === 3 && arr.every(isRealisticDMPersona)) return arr as DMPersona[];
      throw new Error('gemini invalid');
    };
    const deepseekCall = async () => {
      const text = await callDeepseekChatJSON({ user: improvedPrompt + '\nReturn ONLY JSON: {"personas": [ ... ] }', temperature: 0.4, maxTokens: 1200 });
      const obj = JSON.parse(text || '{}');
      const arr = Array.isArray((obj as any)?.personas) ? (obj as any).personas : [];
      if (arr.length === 3 && arr.every(isRealisticDMPersona)) return arr as DMPersona[];
      throw new Error('deepseek invalid');
    };

    // Promise.any polyfill
    const promiseAny = async <T>(arr: Array<Promise<T>>): Promise<T> => new Promise((resolve, reject) => {
      let remaining = arr.length;
      const errors: any[] = [];
      if (remaining === 0) return reject(new Error('No promises'));
      arr.forEach(p => {
        p.then(resolve).catch(err => {
          errors.push(err);
          remaining -= 1;
          if (remaining === 0) reject(errors[0] || err);
        });
      });
    });

    try {
      personas = await promiseAny([fastCall(), primaryCall(), geminiCall(), deepseekCall()]);
    } catch (_) {}
    if (personas.length) {
      const rows = personas.slice(0, 3).map((p: DMPersona) => ({
        search_id: search.id,
        user_id: search.user_id,
        title: p.title,
        rank: p.rank,
        match_score: p.match_score,
        demographics: p.demographics || {},
        characteristics: p.characteristics || {},
        behaviors: p.behaviors || {},
        market_potential: p.market_potential || {}
      }));
      await insertDMPersonas(rows);
      await updateSearchProgress(search.id, 20, 'dm_personas');
      console.log(`Completed DM persona generation for search ${search.id}`);
      return;
    }
    // All LLMs failed, insert 3 deterministic DM personas
    console.error(`[DMPersona] All LLMs failed for search ${search.id}. Inserting deterministic DM personas.`);
    const [countryA] = search.countries.length ? search.countries : ['Global'];
    const rows = [
      {
        search_id: search.id,
        user_id: search.user_id,
        title: 'Chief Technology Officer',
        rank: 1,
        match_score: 92,
        demographics: { level: 'executive', department: 'Technology', experience: '15+ years', geography: countryA },
        characteristics: { responsibilities: ['Technology strategy','Digital transformation'], painPoints: ['Legacy','Security'], motivations: ['Innovation','Efficiency'], challenges: ['Budget','Talent'], decisionFactors: ['Alignment','Scalability'] },
        behaviors: { decisionMaking: 'Strategic', communicationStyle: 'High-level', buyingProcess: 'Committee', preferredChannels: ['Executive briefings','Conferences'] },
        market_potential: { totalDecisionMakers: 1500, avgInfluence: 90, conversionRate: 8 }
      },
      {
        search_id: search.id,
        user_id: search.user_id,
        title: 'VP Operations',
        rank: 2,
        match_score: 88,
        demographics: { level: 'director', department: 'Operations', experience: '10+ years', geography: countryA },
        characteristics: { responsibilities: ['Process optimization','Cost control'], painPoints: ['Inefficiency','Downtime'], motivations: ['Throughput','Quality'], challenges: ['Change mgmt','ROI'], decisionFactors: ['Impact','Time-to-value'] },
        behaviors: { decisionMaking: 'Data-driven', communicationStyle: 'Concise', buyingProcess: 'Cross-functional', preferredChannels: ['Demos','Case studies'] },
        market_potential: { totalDecisionMakers: 3000, avgInfluence: 75, conversionRate: 12 }
      },
      {
        search_id: search.id,
        user_id: search.user_id,
        title: 'Head of Procurement',
        rank: 3,
        match_score: 84,
        demographics: { level: 'manager', department: 'Procurement', experience: '8+ years', geography: countryA },
        characteristics: { responsibilities: ['Vendor selection','Negotiation'], painPoints: ['Compliance','Costs'], motivations: ['Savings','Reliability'], challenges: ['Supplier risk','Integration'], decisionFactors: ['TCO','Compliance'] },
        behaviors: { decisionMaking: 'Criteria-based', communicationStyle: 'Formal', buyingProcess: 'RFP/RFQ', preferredChannels: ['RFP','Email'] },
        market_potential: { totalDecisionMakers: 5000, avgInfluence: 60, conversionRate: 15 }
      }
    ];
    await insertDMPersonas(rows as any);
    await updateSearchProgress(search.id, 20, 'dm_personas');
    console.log(`Inserted deterministic DM personas for search ${search.id}`);
  } catch (error) {
    console.error(`DM persona generation failed for search ${search.id}:`, error);
    throw error;
  }
}