import { resolveModel, callOpenAIChatJSON, callGeminiText, callDeepseekChatJSON } from './clients';
import logger from '../lib/logger';
import { insertMarketInsights, markSearchCompleted, logApiUsage } from '../tools/db.write';
import { extractJson } from '../tools/json';
import { serperSearch } from '../tools/serper';
import * as cheerio from 'cheerio';

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
    const $ = cheerio.load(html);
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
        text = await callOpenAIChatJSON({
          model: modelMini,
          system: 'You are an expert market research analyst that outputs ONLY valid JSON per the user specification.',
          user: prompt,
          temperature: 0.3,
          maxTokens: 5000,
          requireJsonObject: true,
          verbosity: 'low'
        });
        providerUsed = 'openai';
      } catch (e) {
        logger.warn('[MarketResearch] gpt-5-mini failed', { error: (e as any)?.message });
      }
      // 2) Gemini 2.0 Flash
      if (!text) {
        try {
          text = await callGeminiText('gemini-2.0-flash', prompt);
          providerUsed = 'gemini';
        } catch (e) {
          logger.warn('[MarketResearch] gemini-2.0-flash failed', { error: (e as any)?.message });
        }
      }
      // 3) DeepSeek
      if (!text) {
        try {
          text = await callDeepseekChatJSON({ user: prompt, temperature: 0.4, maxTokens: 3500 });
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
    throw new Error('MARKET_RESEARCH_FAILED');
  }
  } catch (error) {
    logger.error('Market research failed', { search_id: search.id, error: (error as any)?.message || error });
    throw new Error('MARKET_RESEARCH_FAILED');
  }
}