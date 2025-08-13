import { Agent, tool } from '@openai/agents';
import { insertDMPersonas } from '../tools/db.write';
import { resolveModel, callOpenAIChatJSON, callGeminiText, callDeepseekChatJSON } from './clients';
import { extractJson } from '../tools/json';

import { sanitizePersona, isRealisticPersona, DMPersona } from '../tools/persona-validation';

import Ajv, { JSONSchemaType } from 'ajv';

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

const ajv = new Ajv({ allErrors: true });

const dmPersonaSchema: JSONSchemaType<DMPersona> = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    rank: { type: 'number' },
    match_score: { type: 'number' },
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
  required: ['title', 'rank', 'match_score', 'demographics', 'characteristics', 'behaviors', 'market_potential'],
  additionalProperties: false
};

const validateDMPersona = ajv.compile<DMPersona>(dmPersonaSchema);

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
      if (!validateDMPersona(p)) {
        import('../lib/logger')
          .then(({ default: logger }) =>
            logger.error('DM persona validation failed', { errors: validateDMPersona.errors, persona: p })
          )
          .catch(() => {});
        throw new Error('Invalid DM persona structure.');
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

export async function runDMPersonas(search: {
  id:string; 
  user_id:string; 
  product_service:string; 
  industries:string[]; 
  countries:string[];
  search_type:'customer'|'supplier';
}) {
  try {
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
    // Sequential fallback: GPT -> Gemini -> DeepSeek, with JSON extraction and sanitization
    const tryParsePersonas = (text: string): any[] => {
      try {
        const obj = JSON.parse(text || '{}');
        return Array.isArray((obj as any)?.personas) ? (obj as any).personas as any[] : [];
      } catch {
        const ex = extractJson(text);
        try {
          const obj = typeof ex === 'string' ? JSON.parse(ex) : ex;
          return Array.isArray((obj as any)?.personas) ? (obj as any).personas as any[] : [];
        } catch { return []; }
      }
    };

    const acceptPersonas = (arr: any[]): DMPersona[] => {
      const three = (arr || []).slice(0,3);
      if (three.length !== 3) return [];
      return three.map((p, i) => sanitizePersona('dm', p, i, search));
    };

    const ensureProductServiceKeywords = async (arr: DMPersona[]): Promise<DMPersona[]> => {
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

    try {
      // 1) GPT-5 primary
      const text = await callOpenAIChatJSON({
        model: resolveModel('primary'),
        system: 'Return ONLY JSON: {"personas": [ ... ] } with exactly 3 complete decision-maker persona objects.',
        user: improvedPrompt,
        temperature: 0.3,
        maxTokens: 1400,
        requireJsonObject: true,
        verbosity: 'low'
      });
      let accepted = acceptPersonas(tryParsePersonas(text));
      if (accepted.length === 3) personas = await ensureProductServiceKeywords(accepted);
    } catch {}
    if (!personas.length) {
      // 2) Gemini fallback
      try {
        const text = await callGeminiText('gemini-2.0-flash', improvedPrompt + '\nReturn ONLY JSON: {"personas": [ ... ] }');
        let accepted = acceptPersonas(tryParsePersonas(text));
        if (accepted.length === 3) personas = await ensureProductServiceKeywords(accepted);
      } catch {}
    }
    if (!personas.length) {
      // 3) DeepSeek fallback
      try {
        const text = await callDeepseekChatJSON({ user: improvedPrompt + '\nReturn ONLY JSON: {"personas": [ ... ] }', temperature: 0.4, maxTokens: 1200 });
        let accepted = acceptPersonas(tryParsePersonas(text));
        if (accepted.length === 3) personas = await ensureProductServiceKeywords(accepted);
      } catch {}
    }
    if (personas.length) {

      const allRealistic = personas.every(p => isRealisticPersona('dm', p));
      if (!allRealistic) {

      const allValid = personas.every(p => validateDMPersona(p));
      if (!allValid) {
        import('../lib/logger')
          .then(({ default: logger }) => logger.error('DM persona schema validation failed', { errors: validateDMPersona.errors }))
          .catch(() => {});

        personas = [];
      }
    }
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
    import('../lib/logger').then(({ default: logger }) => logger.info('Completed DM persona generation', { search_id: search.id })).catch(()=>{});
      await updateSearchProgress(search.id, 20, 'dm_personas');
      import('../lib/logger').then(({ default: logger }) => logger.info('Completed DM persona generation', { search_id: search.id })).catch(()=>{});
      return;
    }
    // All LLMs failed, insert 3 deterministic DM personas
    import('../lib/logger').then(({ default: logger }) => logger.error('[DMPersona] All LLMs failed, inserting deterministic personas', { search_id: search.id })).catch(()=>{});
    const [countryA] = search.countries.length ? search.countries : ['Global'];

    const [industryA] = search.industries.length ? search.industries : ['General'];
    // Tailor fallback personas to search context so results remain relevant even without model output
    const deptTemplates = [`${industryA} Technology`, `${industryA} Operations`, `${industryA} Procurement`];
    const levelTemplates = [`executive (${countryA})`, `director (${countryA})`, `manager (${countryA})`];
    const rows = [

    const fallback: DMPersona[] = [
      {
        title: 'Chief Technology Officer',
        rank: 1,
        match_score: 92,
        demographics: { level: levelTemplates[0], department: deptTemplates[0], experience: '15+ years', geography: countryA },
        characteristics: { responsibilities: ['Technology strategy','Digital transformation'], painPoints: ['Legacy','Security'], motivations: ['Innovation','Efficiency'], challenges: ['Budget','Talent'], decisionFactors: ['Alignment','Scalability'] },
        behaviors: { decisionMaking: 'Strategic', communicationStyle: 'High-level', buyingProcess: 'Committee', preferredChannels: ['Executive briefings','Conferences'] },
        market_potential: { totalDecisionMakers: 1500, avgInfluence: 90, conversionRate: 8 }
      },
      {
        title: 'VP Operations',
        rank: 2,
        match_score: 88,
        demographics: { level: levelTemplates[1], department: deptTemplates[1], experience: '10+ years', geography: countryA },
        characteristics: { responsibilities: ['Process optimization','Cost control'], painPoints: ['Inefficiency','Downtime'], motivations: ['Throughput','Quality'], challenges: ['Change mgmt','ROI'], decisionFactors: ['Impact','Time-to-value'] },
        behaviors: { decisionMaking: 'Data-driven', communicationStyle: 'Concise', buyingProcess: 'Cross-functional', preferredChannels: ['Demos','Case studies'] },
        market_potential: { totalDecisionMakers: 3000, avgInfluence: 75, conversionRate: 12 }
      },
      {
        title: 'Head of Procurement',
        rank: 3,
        match_score: 84,
        demographics: { level: levelTemplates[2], department: deptTemplates[2], experience: '8+ years', geography: countryA },
        characteristics: { responsibilities: ['Vendor selection','Negotiation'], painPoints: ['Compliance','Costs'], motivations: ['Savings','Reliability'], challenges: ['Supplier risk','Integration'], decisionFactors: ['TCO','Compliance'] },
        behaviors: { decisionMaking: 'Criteria-based', communicationStyle: 'Formal', buyingProcess: 'RFP/RFQ', preferredChannels: ['RFP','Email'] },
        market_potential: { totalDecisionMakers: 5000, avgInfluence: 60, conversionRate: 15 }
      }
    ];

    await insertDMPersonas(rows as any);

    for (const p of fallback) {
      if (!validateDMPersona(p)) {
        import('../lib/logger')
          .then(({ default: logger }) => logger.error('Fallback DM persona validation failed', { errors: validateDMPersona.errors, persona: p }))
          .catch(() => {});
        throw new Error('Invalid fallback DM persona.');
      }
    }
    const rows = fallback.map((p: DMPersona) => ({
      search_id: search.id,
      user_id: search.user_id,
      title: p.title,
      rank: p.rank,
      match_score: p.match_score,
      demographics: p.demographics,
      characteristics: p.characteristics,
      behaviors: p.behaviors,
      market_potential: p.market_potential
    }));
    await insertDMPersonas(rows);
    await updateSearchProgress(search.id, 20, 'dm_personas');

    import('../lib/logger').then(({ default: logger }) => logger.info('Inserted deterministic DM personas', { search_id: search.id })).catch(()=>{});
  } catch (error) {
  import('../lib/logger').then(({ default: logger }) => logger.error('DM persona generation failed', { search_id: search.id, error: (error as any)?.message || error })).catch(()=>{});
    throw error;
  }
}