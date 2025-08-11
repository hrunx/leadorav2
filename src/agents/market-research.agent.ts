import { resolveModel, callOpenAIChatJSON, callGeminiText, callDeepseekChatJSON } from './clients';
import { insertMarketInsights, updateSearchProgress, markSearchCompleted, logApiUsage } from '../tools/db.write';
import { extractJson } from '../tools/json';
import { serperSearch } from '../tools/serper';

export async function runMarketResearch(search: {
  id:string; 
  user_id:string; 
  product_service:string; 
  industries:string[]; 
  countries:string[];
  search_type: 'customer' | 'supplier';
}) {
  try {
    await updateSearchProgress(search.id, 90, 'market_research', 'in_progress');
    console.log(`Starting market research for search ${search.id}`);
    
    // Prefetch strong external sources per country and industry to ground the analysis
    const countries = (search.countries || []).slice(0, 3);
    const industriesStr = (search.industries || []).join(' ');
    const baseQuery = `${search.product_service} ${industriesStr}`.trim();
    const queryTemplates = [
      `${baseQuery} market size TAM SAM SOM 2024 2025 report`,
      `${baseQuery} industry report competitors top players`,
      `${baseQuery} growth rate CAGR by country regulation policy 2024`,
      `${baseQuery} adoption trends demand forecast 2025`
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
    }).slice(0, 12);

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
        console.warn('[MarketResearch] gpt-5-mini failed:', (e as any).message);
      }
      // 2) Gemini 2.0 Flash
      if (!text) {
        try {
          text = await callGeminiText('gemini-2.0-flash', prompt);
          providerUsed = 'gemini';
        } catch (e) {
          console.warn('[MarketResearch] gemini-2.0-flash failed:', (e as any).message);
        }
      }
      // 3) DeepSeek
      if (!text) {
        try {
          text = await callDeepseekChatJSON({ user: prompt, temperature: 0.4, maxTokens: 3500 });
          providerUsed = 'deepseek';
        } catch (e) {
          console.warn('[MarketResearch] deepseek failed:', (e as any).message);
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
        console.error(`[MarketResearch] Market research returned empty or unparseable output for search ${search.id}. Inserting placeholder insights.`);
        // Log failure (no valid model output)
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
        const placeholder = {
          search_id: search.id,
          user_id: search.user_id,
          tam_data: { value: 'N/A', growth: 'N/A', description: 'No data', calculation: 'No data' },
          sam_data: { value: 'N/A', growth: 'N/A', description: 'No data', calculation: 'No data' },
          som_data: { value: 'N/A', growth: 'N/A', description: 'No data', calculation: 'No data' },
          competitor_data: [],
          trends: [],
          opportunities: {},
          sources: sources.map(s => s.url),
          analysis_summary: 'Market research failed: no data',
          research_methodology: 'Model returned empty or unparseable output.'
        };
        await insertMarketInsights(placeholder);
        await markSearchCompleted(search.id);
        return;
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

      const row = {
        search_id: search.id,
        user_id: search.user_id,
        tam_data: data.tam_data || {},
        sam_data: data.sam_data || {},
        som_data: data.som_data || {},
        competitor_data: data.competitor_data || [],
        trends: data.trends || [],
        opportunities: data.opportunities || {},
        sources: (data.sources && Array.isArray(data.sources)) ? data.sources : sources.map(s => s.url),
        analysis_summary: data.analysis_summary || 'Market research completed using OpenAI GPT-5 analysis',
        research_methodology: data.research_methodology || 'AI-assisted market analysis grounded in recent web sources and country/industry context'
      };

    await insertMarketInsights(row);
    await markSearchCompleted(search.id);
    console.log(`Completed market research for search ${search.id}`);
    
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
    throw error;
  }
  } catch (error) {
    console.error(`Market research failed for search ${search.id}:`, error);
    throw error;
  }
}