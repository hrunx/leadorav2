import { Agent, tool } from '@openai/agents';
import { insertDMPersonas, updateSearchProgress } from '../tools/db.write';
import { gemini } from './clients';

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
  strict: true,
  execute: async (input: unknown) => {
    const { search_id, user_id, personas } = input as StoreDMPersonasToolInput;
    if (!Array.isArray(personas) || personas.length !== 5) {
      throw new Error('Expected exactly 5 personas.');
    }
    for (const p of personas) {
      for (const k of ['title','rank','match_score','demographics','characteristics','behaviors','market_potential']) {
        if (!(k in p)) throw new Error(`persona missing key: ${k}`);
      }
    }
    const rows = personas.slice(0,5).map((p: DMPersona, idx: number) => ({
      id: `${search_id}-dm-${idx+1}`,
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
    const improvedPrompt = `Generate 5 decision-maker personas for:
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
- Output as a JSON array of 5 persona objects with all required fields.`;
    // Try Gemini first
    try {
      const model = gemini.getGenerativeModel({ model: 'gemini-1.5-pro' });
      const res = await model.generateContent([{ text: improvedPrompt }]);
      const text = res.response.text().trim();
      const json = JSON.parse(text.match(/\[.*\]/s)?.[0] || '[]');
      if (Array.isArray(json) && json.length === 5 && json.every(isRealisticDMPersona)) {
        personas = json;
        const rows = personas.slice(0, 5).map((p: DMPersona, idx: number) => ({
          id: `${search.id}-dm-gemini-${idx+1}`,
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
        if (!rows.every(isRealisticDMPersona)) {
          throw new Error('One or more personas failed strict validation.');
        }
        await insertDMPersonas(rows);
        await updateSearchProgress(search.id, 20, 'dm_personas_completed');
        console.log(`Completed DM persona generation for search ${search.id} (Gemini)`);
        return;
      }
    } catch (geminiError: any) {
      console.warn(`[DMPersona] Gemini failed:`, (geminiError as any).message);
    }
    // Try GPT-4 next
    try {
      const { OpenAI } = await import('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: improvedPrompt }],
        max_tokens: 2048,
        temperature: 0.7
      });
      const text = completion.choices[0]?.message?.content?.trim() || '';
      const json = JSON.parse(text.match(/\[.*\]/s)?.[0] || '[]');
      if (Array.isArray(json) && json.length === 5 && json.every(isRealisticDMPersona)) {
        personas = json;
        const rows = personas.slice(0, 5).map((p: DMPersona, idx: number) => ({
          id: `${search.id}-dm-gpt4-${idx+1}`,
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
        if (!rows.every(isRealisticDMPersona)) {
          throw new Error('One or more personas failed strict validation.');
        }
        await insertDMPersonas(rows);
        await updateSearchProgress(search.id, 20, 'dm_personas_completed');
        console.log(`Completed DM persona generation for search ${search.id} (GPT-4)`);
        return;
      }
    } catch (gptError: any) {
      console.warn(`[DMPersona] GPT-4 failed:`, (gptError as any).message);
    }
    // Try DeepSeek next
    try {
      const { deepseek } = await import('./clients');
      const model = deepseek.getGenerativeModel({ model: 'deepseek-coder' });
      const res = await model.generateContent([{ text: improvedPrompt }]);
      const text = res.response.text().trim();
      const json = JSON.parse(text.match(/\[.*\]/s)?.[0] || '[]');
      if (Array.isArray(json) && json.length === 5 && json.every(isRealisticDMPersona)) {
        personas = json;
        const rows = personas.slice(0, 5).map((p: DMPersona, idx: number) => ({
          id: `${search.id}-dm-deepseek-${idx+1}`,
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
        if (!rows.every(isRealisticDMPersona)) {
          throw new Error('One or more personas failed strict validation.');
        }
        await insertDMPersonas(rows);
        await updateSearchProgress(search.id, 20, 'dm_personas_completed');
        console.log(`Completed DM persona generation for search ${search.id} (DeepSeek)`);
        return;
      }
    } catch (deepseekError: any) {
      console.warn(`[DMPersona] DeepSeek failed:`, (deepseekError as any).message);
    }
    // All LLMs failed, insert placeholder
    console.error(`[DMPersona] All LLMs failed for search ${search.id}. Inserting placeholder persona.`);
    const placeholder = [{
      id: `${search.id}-dm-placeholder-1`,
      search_id: search.id,
      user_id: search.user_id,
      title: 'Persona Generation Failed',
      rank: 1,
      match_score: 0,
      demographics: { level: 'N/A', department: 'N/A', experience: 'N/A', geography: 'N/A' },
      characteristics: { responsibilities: ['N/A'], painPoints: ['N/A'], motivations: ['N/A'], challenges: ['N/A'], decisionFactors: ['N/A'] },
      behaviors: { decisionMaking: 'N/A', communicationStyle: 'N/A', buyingProcess: 'N/A', preferredChannels: ['N/A'] },
      market_potential: { totalDecisionMakers: 0, avgInfluence: 0, conversionRate: 0 }
    }];
    await insertDMPersonas(placeholder);
    await updateSearchProgress(search.id, 20, 'dm_personas_completed');
    console.log(`Inserted placeholder persona for search ${search.id}`);
  } catch (error) {
    console.error(`DM persona generation failed for search ${search.id}:`, error);
    throw error;
  }
}