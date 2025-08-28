import { Agent, tool, run } from '@openai/agents';
import { resolveModel, callOpenAIChatJSON, callGeminiText, callDeepseekChatJSON } from './clients';
import logger from '../lib/logger';
import { insertMarketInsights, markSearchCompleted, logApiUsage } from '../tools/db.write';
import { extractJson } from '../tools/json';
import { serperSearch } from '../tools/serper';
import { jsonSchemaFromZod } from '../lib/structured';
import { MarketInsightsSchema } from '../lib/marketInsightsSchema';
async function getCheerio(): Promise<null | typeof import('cheerio')> {
  try {
    const mod = await import('cheerio');
    return mod;
  } catch {
    return null;
  }
}

function parseCurrencyToNumber(value: string): number | null {
  if (!value) return null;
  const match = value
    .replace(/[$,]/g, '')
    .match(/([\d.]+)\s*(B|M|K|billion|million|thousand)?/i);
  if (!match) return null;
  let num = parseFloat(match[1]);
  const unit = match[2]?.toLowerCase();
  if (unit) {
    if (unit.startsWith('b')) num *= 1e9;
    else if (unit.startsWith('m')) num *= 1e6;
    else if (unit.startsWith('k') || unit.startsWith('t')) num *= 1e3;
  }
  return isNaN(num) ? null : num;
}

async function fetchNumberFromSource(url: string, expected: number | null): Promise<number | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const html = await res.text();
    const ch = await getCheerio();
    if (!ch) return null;
    const $ = ch.load(html);
    const text = $('body').text();
    const matches = text.match(/[$€£]?\s?[\d,.]+\s?(?:billion|million|thousand|bn|m|k|B|M|K)?/gi) || [];
    const numbers = matches.map(m => parseCurrencyToNumber(m)).filter(n => n !== null) as number[];
    if (expected !== null) {
      const found = numbers.find(n => Math.abs(n - expected) / expected < 0.1);
      return found ?? null;
    }
    return numbers[0] ?? null;
  } catch {
    return null;
  }
}

async function verifyEntry(entry: any): Promise<{ verified: boolean; confidence: number }> {
  if (!entry || !entry.value || !entry.source) {
    return { verified: false, confidence: 0.1 };
  }
  const expected = parseCurrencyToNumber(entry.value);
  const found = await fetchNumberFromSource(entry.source, expected);
  if (found !== null && expected !== null) {
    const diff = Math.abs(found - expected) / expected;
    if (diff < 0.1) return { verified: true, confidence: 0.9 };
    return { verified: false, confidence: 0.3 };
  }
  return { verified: false, confidence: 0.2 };
}


export async function runMarketResearch(search: {
  id:string; 
  user_id:string; 
  product_service:string; 
  industries:string[]; 
  countries:string[];
  search_type: 'customer' | 'supplier';
}) {
  try {
    logger.info('Starting market research', { search_id: search.id });
    
    // Prefetch strong external sources per country and industry to ground the analysis
    const countries = (search.countries || []).slice(0, 3);
    const industriesStr = (search.industries || []).join(' ');
    const baseQuery = `${search.product_service} ${industriesStr}`.trim();
    const queryTemplates = [
      `${baseQuery} market size report`,
      `${baseQuery} competitors top players`,
      `${baseQuery} growth rate CAGR`,
      `${baseQuery} trends forecast`
    ];
    const webFindings = (
      await Promise.all(
        countries.map(async (country) => {
          const perCountry = await Promise.all(
            queryTemplates.map(async (qt) => {
              const r = await serperSearch(`${qt} ${country}`, country, 5).catch(() => ({ success:false, items:[] } as any));
              return (r && (r as any).success ? (r as any).items : []).map((i: any) => ({ title: i.title, url: i.link }));
            })
          );
          return perCountry.flat();
        })
      )
    ).flat();
    // Deduplicate by URL
    const seen = new Set<string>();
    const sources = webFindings.filter(({ url }) => {
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    }).slice(0, 8);

    const sourcesForPrompt = sources.map(s => `- ${s.title} (${s.url})`).join('\n');

  const prompt = `
You are an expert market research analyst. Produce an investor-grade market analysis that is fully grounded in recent, reputable sources. Every numeric figure MUST be backed by a specific citation URL.

SEARCH CONTEXT:
- Product/Service: ${search.product_service}
- Target Industries: ${search.industries.join(', ')}
- Target Countries: ${search.countries.join(', ')}
- Lens: ${search.search_type === 'customer' ? 'Customer demand and adoption' : 'Supplier capacity and supply chain'}

REFERENCE SOURCES (use as anchors; you may add more you know but always cite):
${sourcesForPrompt}

STRICT REQUIREMENTS:
1) Provide country-specific TAM, SAM, and SOM with explicit methodology and assumptions. Use currency formatting like $2.4B, $850M, +15%.
2) All numbers (market size, growth/CAGR, competitor revenue/share) MUST include a direct source URL in the JSON.
3) Competitor analysis must list 4-6 named companies operating in these industries/countries with revenue/share and a source.
4) Include 4-6 trends with impact and source.
5) Include an opportunities playbook with actionable actions and timing.
6) Avoid placeholders or generic content. If you must infer, state assumptions.
7) Output ONLY valid JSON matching the schema below.

OUTPUT JSON SCHEMA EXACTLY:
{
  "tam_data": {
    "value": "$X.XB",
    "growth": "+XX%",
    "description": "Total Addressable Market",
    "calculation": "methodology and assumptions",
    "source": "https://..."
  },
  "sam_data": {
    "value": "$XXXM",
    "growth": "+XX%",
    "description": "Serviceable Addressable Market",
    "calculation": "methodology and assumptions",
    "source": "https://..."
  },
  "som_data": {
    "value": "$XXM",
    "growth": "+XX%",
    "description": "Serviceable Obtainable Market",
    "calculation": "methodology and assumptions",
    "source": "https://..."
  },
  "competitor_data": [
    { "name": "Company", "marketShare": XX, "revenue": "$XXXM", "growth": "+XX%", "notes": "context", "source": "https://..." }
  ],
  "trends": [
    { "trend": "Trend", "impact": "High|Medium|Low", "growth": "+XX%", "description": "impact analysis", "source": "https://..." }
  ],
  "opportunities": {
    "summary": "Key market opportunities overview",
    "playbook": ["actionable strategy 1", "actionable strategy 2", "actionable strategy 3"],
    "market_gaps": ["gap 1", "gap 2"],
    "timing": "market timing analysis"
  },
  "sources": [
    { "title": "Source Title", "url": "https://...", "date": "YYYY-MM", "used_for": ["TAM", "Competitors", "Trends"] }
  ],
  "analysis_summary": "Executive summary",
  "research_methodology": "How the analysis was constructed and any assumptions"
}`;

  const startTime = Date.now();
  const modelMini = resolveModel('primary');
  
    let providerUsed: 'openai' | 'gemini' | 'deepseek' = 'openai';
    try {
      // 1) Try OpenAI GPT‑5 (preferred)
      let text: string | null = null;
      try {
        const schema = jsonSchemaFromZod('MarketInsights', MarketInsightsSchema);
        text = await callOpenAIChatJSON({
          model: modelMini,
          system: 'You output ONLY valid JSON that matches the provided schema.',
          user: prompt,
          temperature: 0.3,
          maxTokens: 5000,
          jsonSchema: schema,
          schemaName: 'MarketInsights',
          verbosity: 'low',
          timeoutMs: 20000,
          retries: 2,
          meta: { user_id: search.user_id, search_id: search.id, endpoint: 'market_research' }
        });
        providerUsed = 'openai';
      } catch (e) {
        logger.warn('[MarketResearch] gpt-5-mini failed', { error: (e as any)?.message });
      }
      // 2) Gemini 2.0 Flash
      if (!text) {
        try {
          text = await callGeminiText('gemini-2.0-flash', prompt, 20000, 2);
          providerUsed = 'gemini';
        } catch (e) {
          logger.warn('[MarketResearch] gemini-2.0-flash failed', { error: (e as any)?.message });
        }
      }
      // 3) DeepSeek
      if (!text) {
        try {
          text = await callDeepseekChatJSON({ user: prompt, temperature: 0.4, maxTokens: 3500, timeoutMs: 20000, retries: 1 });
          providerUsed = 'deepseek';
        } catch (e) {
          logger.warn('[MarketResearch] deepseek failed', { error: (e as any)?.message });
        }
      }
    text = (text || '').trim();

      // Try to extract JSON using utility; fallback to direct parse due to response_format
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = extractJson(text);
      }
      let data: any = {};
      if (!json) {
        logger.error('[MarketResearch] Empty or unparseable output; aborting without placeholder', { search_id: search.id });
        // Log failure and propagate; do not insert placeholders
        await logApiUsage({
          user_id: search.user_id,
          search_id: search.id,
          provider: providerUsed,
          endpoint: 'market_research',
          status: 502,
          ms: Date.now() - startTime,
          request: { model: modelMini, sources_candidate_count: sources.length },
          response: { error: 'empty_or_unparseable_output' }
        });
        throw new Error('MARKET_RESEARCH_FAILED');
      }
      data = json;

      // Log successful API usage after we confirm we have parsable JSON
      await logApiUsage({
        user_id: search.user_id,
        search_id: search.id,
        provider: providerUsed,
        endpoint: 'market_research',
        status: 200,
        ms: Date.now() - startTime,
        request: { model: modelMini, sources_candidate_count: sources.length },
        response: { text_length: text.length }
      });

      // Verify market size entries against cited sources
      const mismatched: string[] = [];
      const tamCheck = await verifyEntry(data.tam_data || {});
      data.tam_data = { ...(data.tam_data || {}), confidence: tamCheck.confidence, verified: tamCheck.verified };
      if (!tamCheck.verified) mismatched.push('TAM');
      const samCheck = await verifyEntry(data.sam_data || {});
      data.sam_data = { ...(data.sam_data || {}), confidence: samCheck.confidence, verified: samCheck.verified };
      if (!samCheck.verified) mismatched.push('SAM');
      const somCheck = await verifyEntry(data.som_data || {});
      data.som_data = { ...(data.som_data || {}), confidence: somCheck.confidence, verified: somCheck.verified };
      if (!somCheck.verified) mismatched.push('SOM');

      // If any numbers failed verification, attempt regeneration with stricter prompts
      if (mismatched.length) {
        const strictPrompt = `${prompt}\nThe previous response contained incorrect or unverified values for: ${mismatched.join(', ')}. Cross-check the cited URLs and regenerate accurate numbers. Output ONLY valid JSON.`;
        try {
          let regenText = await callOpenAIChatJSON({
            model: modelMini,
            system: 'You are an expert market research analyst that outputs ONLY valid JSON per the user specification.',
            user: strictPrompt,
            temperature: 0.2,
            maxTokens: 5000,
            requireJsonObject: true,
            verbosity: 'low'
          });
          regenText = (regenText || '').trim();
          let regenJson: any;
          try {
            regenJson = JSON.parse(regenText);
          } catch {
            regenJson = extractJson(regenText);
          }
          if (regenJson) {
            data = regenJson;
            const tCheck = await verifyEntry(data.tam_data || {});
            data.tam_data = { ...(data.tam_data || {}), confidence: tCheck.confidence, verified: tCheck.verified };
            const sCheck = await verifyEntry(data.sam_data || {});
            data.sam_data = { ...(data.sam_data || {}), confidence: sCheck.confidence, verified: sCheck.verified };
            const soCheck = await verifyEntry(data.som_data || {});
            data.som_data = { ...(data.som_data || {}), confidence: soCheck.confidence, verified: soCheck.verified };
          }
        } catch (e) {
          logger.warn('Regeneration attempt failed', { error: (e as any)?.message });
        }
      }

      const row = {
        search_id: search.id,
        user_id: search.user_id,
        tam_data: data.tam_data || {},
        sam_data: data.sam_data || {},
        som_data: data.som_data || {},
        competitor_data: data.competitor_data || [],
        trends: data.trends || [],
        opportunities: data.opportunities || {},
        sources: Array.isArray(data.sources) && data.sources.length
          ? data.sources.map((s: any) => typeof s === 'string' ? { title: s, url: s } : s)
          : sources.map(({ title, url }) => ({ title, url })),
        analysis_summary: data.analysis_summary || 'Market research completed using OpenAI GPT-5 analysis',
        research_methodology: data.research_methodology || 'AI-assisted market analysis grounded in recent web sources and country/industry context'
      };

    await insertMarketInsights(row);
    await markSearchCompleted(search.id);
    logger.info('Completed market research', { search_id: search.id });
    
  } catch (error: any) {
    // Log failed API usage
    await logApiUsage({
      user_id: search.user_id,
      search_id: search.id,
      provider: providerUsed,
      endpoint: 'market_research',
      status: 500,
      ms: Date.now() - startTime,
      request: { model: modelMini },
      response: { error: error.message }
    });
    // Propagate standardized error; the orchestrator will handle downstream status
    logger.error('Market research provider chain failed', { search_id: search.id, provider: providerUsed, error: error?.message || error });
    throw new Error('MARKET_RESEARCH_FAILED');
  }
  } catch (error) {
    logger.error('Market research failed', { search_id: search.id, error: (error as any)?.message || error });
    throw new Error('MARKET_RESEARCH_FAILED');
  }
}

// --- Agent-first version ---
const storeMarketInsightsTool = tool({
  name: 'storeMarketInsights',
  description: 'Persist market insights once as a single row for the search.',
  parameters: {
    type: 'object',
    properties: {
      search_id: { type: 'string' },
      user_id: { type: 'string' },
      tam_data: {
        type: 'object',
        properties: {
          value: { type: 'string' },
          growth: { type: 'string' },
          description: { type: 'string' },
          calculation: { type: 'string' },
          source: { type: 'string' }
        },
        required: ['value','growth','description','calculation','source'],
        additionalProperties: false
      },
      sam_data: {
        type: 'object',
        properties: {
          value: { type: 'string' },
          growth: { type: 'string' },
          description: { type: 'string' },
          calculation: { type: 'string' },
          source: { type: 'string' }
        },
        required: ['value','growth','description','calculation','source'],
        additionalProperties: false
      },
      som_data: {
        type: 'object',
        properties: {
          value: { type: 'string' },
          growth: { type: 'string' },
          description: { type: 'string' },
          calculation: { type: 'string' },
          source: { type: 'string' }
        },
        required: ['value','growth','description','calculation','source'],
        additionalProperties: false
      },
      competitor_data: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            marketShare: { type: 'number' },
            revenue: { type: 'string' },
            growth: { type: 'string' },
            notes: { type: 'string' },
            source: { type: 'string' }
          },
          required: ['name','source'],
          additionalProperties: false
        }
      },
      trends: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            trend: { type: 'string' },
            impact: { type: 'string' },
            growth: { type: 'string' },
            description: { type: 'string' },
            source: { type: 'string' }
          },
          required: ['trend','impact','source'],
          additionalProperties: false
        }
      },
      opportunities: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          playbook: { type: 'array', items: { type: 'string' } },
          market_gaps: { type: 'array', items: { type: 'string' } },
          timing: { type: 'string' }
        },
        required: ['summary'],
        additionalProperties: false
      },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            url: { type: 'string' },
            date: { type: 'string' },
            used_for: { type: 'array', items: { type: 'string' } }
          },
          additionalProperties: false
        }
      },
      analysis_summary: { type: 'string' },
      research_methodology: { type: 'string' }
    },
    required: ['search_id','user_id','tam_data','sam_data','som_data','competitor_data','trends','opportunities'],
    additionalProperties: false
  } as const,
  strict: true,
  execute: async (input: any) => {
    const row = {
      search_id: String(input.search_id),
      user_id: String(input.user_id),
      tam_data: input.tam_data || {},
      sam_data: input.sam_data || {},
      som_data: input.som_data || {},
      competitor_data: Array.isArray(input.competitor_data) ? input.competitor_data : [],
      trends: Array.isArray(input.trends) ? input.trends : [],
      opportunities: input.opportunities || {},
      sources: Array.isArray(input.sources) ? input.sources : [],
      analysis_summary: typeof input.analysis_summary === 'string' ? input.analysis_summary : undefined,
      research_methodology: typeof input.research_methodology === 'string' ? input.research_methodology : undefined
    };
    await insertMarketInsights(row as any);
    await markSearchCompleted(String(input.search_id));
    return { success: true };
  }
});

export const MarketResearchAgent = new Agent({
  name: 'MarketResearchAgent',
  tools: [storeMarketInsightsTool],
  model: resolveModel('primary'),
  handoffDescription: 'Generates investor-grade market insights and stores them via tool',
  handoffs: [],
  instructions: `You are an expert market research analyst. Using the provided search context, produce high-quality, source-grounded market insights and then call storeMarketInsights ONCE with the full JSON. Output NOTHING else.

Context keys you will receive: search_id, user_id, product_service, industries, countries, search_type.
Requirements:
- Provide country-specific TAM, SAM, SOM with calculation and explicit assumptions.
- Competitors: 4–8 with share/revenue/growth and citations.
- Trends: 4–8 with impact and citations.
- Opportunities: summary + actionable playbook and timing.
- Include sources array.
- When done, call storeMarketInsights with the full object.`
});

export async function runMarketResearchAgent(search: {
  id:string; user_id:string; product_service:string; industries:string[]; countries:string[]; search_type:'customer'|'supplier'
}) {
  const msg = `search_id=${search.id} user_id=${search.user_id} product_service="${search.product_service}" industries="${(search.industries||[]).join(', ')}" countries="${(search.countries||[]).join(', ')}" search_type=${search.search_type}`;
  await run(MarketResearchAgent, msg);
}
