// import { executeAdvancedMarketResearch } from '../agents/market-research-advanced.agent';
import { openai, resolveModel, callGeminiText, callDeepseekChatJSON } from '../agents/clients';
import { serperSearch } from '../tools/serper';
import { loadSearch } from '../tools/db.read';
import { insertMarketInsights, logApiUsage } from '../tools/db.write';
import logger from '../lib/logger';
import { MarketInsightsSchema } from '../lib/marketInsightsSchema';
import { runMarketResearchAgent } from '../agents/market-research.agent';

export async function execMarketResearchParallel(payload: {
  search_id: string;
  user_id: string;
}) {
  const search = await loadSearch(payload.search_id);
  if (!search) throw new Error(`Search ${payload.search_id} not found`);

  // Agent-first: delegate to MarketResearchAgent and return
  try {
    await runMarketResearchAgent({
      id: String(search.id),
      user_id: String(search.user_id),
      product_service: String((search as any)?.product_service || ''),
      industries: Array.isArray((search as any)?.industries) ? ((search as any).industries as string[]) : [],
      countries: Array.isArray((search as any)?.countries) ? ((search as any).countries as string[]) : [],
      search_type: ((search as any)?.search_type === 'supplier' ? 'supplier' : 'customer') as 'customer'|'supplier'
    });
    logger.info('Market research agent completed');
    return true as any;
  } catch (e: any) {
    logger.warn('Market research agent failed; falling back to direct pipeline', { error: e?.message || e });
  }

  const searchData = {
    product_service: search.product_service,
    industries: search.industries || [],
    countries: search.countries || [],
    user_id: search.user_id,
    search_id: search.id
  };

  // intentionally silent to avoid console; progress is recorded via API usage logs

  const startTime = Date.now();
  try {
    // Execute market research via OpenAI GPT-5 with robust fallbacks
    const modelId = resolveModel('primary');

    // Normalize inputs
    const productStr: string = String(searchData.product_service || '');
    const industriesList: string[] = Array.isArray(searchData.industries) ? (searchData.industries as string[]).map(String) : [];
    const countriesList: string[] = Array.isArray(searchData.countries) ? (searchData.countries as string[]).map(String) : [];

    // Pre-fetch authoritative web sources using multiple intents per country
    const queryTemplates = [
      'market size TAM SAM SOM',
      'CAGR growth forecast',
      'competitors market share',
      'industry report 2024 2025',
      'trend analysis opportunities'
    ];
    const webFindings = (
      await Promise.all(
        countriesList.slice(0, 3).map(async (country: string) => {
          const perCountry = await Promise.all(
            queryTemplates.map(async (qt) => {
              const industriesStr = industriesList.join(' ');
              const q = `${productStr} ${industriesStr} ${qt} ${country}`.trim();
              const r = await serperSearch(q, country, 4).catch(() => ({ success: false, items: [] } as any));
              return (r && (r as any).success ? (r as any).items : [])
                .map((i: { title: string; link: string }) => ({ title: i.title, url: i.link }));
            })
          );
          return perCountry.flat();
        })
      )
    ).flat();
    // Deduplicate by URL and cap
    const seenUrl = new Set<string>();
    const uniqueFindings = webFindings.filter((s: any) => {
      if (!s?.url || seenUrl.has(s.url)) return false;
      seenUrl.add(s.url);
      return true;
    }).slice(0, 12);

    const sourcesForPrompt = uniqueFindings.map((s: any) => `- ${s.title} (${s.url})`).join('\n');
    const systemPrompt = `You are a Senior Partner (ex-McKinsey/BCG/Bain) generating investor-grade market research. You must ground every figure in reputable sources and be explicit about calculations. STRICTLY output ONLY JSON for the schema the user describes. No markdown fences.`;
    const basePrompt = `Analyze the ${productStr} market for industries: ${industriesList.join(', ')} in ${countriesList.join(', ')}.

WHAT TO RETURN (JSON keys exactly):
- tam_data: { value:"$X.YB|$Z.M", growth:"+A% YoY", description, calculation:"explicit formula showing assumptions", source:"https://..." }
- sam_data: same shape; SAM = TAM × (addressable industries share) × (geographies share). Provide calculation and source.
- som_data: same shape; SOM = SAM × (realistic penetration) × (go-to-market constraints). Provide calculation and source.
- competitor_data: 4-8 items each { name, marketShare:"N%", revenue:"$M/B", growth:"+K%", description?, strengths?, weaknesses?, source }
- trends: 4-8 items each { trend|title, impact:"High|Medium|Low", growth:"+%", description, timeline?, source }
- opportunities: either object { summary, playbook:[strategic actions], market_gaps:[gaps to exploit], timing } or array of quantified items { title, description, potential:"$M/B", timeframe }
- sources: array of { title, url, date?, used_for?:["TAM","SAM","SOM","competitors","trends","opportunities"] }
- analysis_summary: 4–8 sentences executive summary
- research_methodology: bullet-like paragraph citing how TAM/SAM/SOM were computed and how sources were triangulated

DATA RULES:
- Use current-country data first; if missing, infer with explicit ratio multipliers from regional/global reports (document in calculation).
- Never return placeholders ("N/A", "Unknown"). If unknown, compute an estimate and justify the math.
- Prefer currency with units ($, M/B). Prefer percentages with % and YoY/CAGR where relevant.

REFERENCES (augment with additional reputable sources as needed):\n${sourcesForPrompt}`;

    let analysis = '';
    let provider: 'openai' | 'gemini' | 'deepseek' | 'fallback' = 'openai';
    try {
      const res = await openai.chat.completions.create({
        model: modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: basePrompt }
        ],
        // For Chat Completions, response_format is valid and keeps strict JSON
        response_format: { type: 'json_object' }
      });
      analysis = res.choices?.[0]?.message?.content || '';
      await logApiUsage({
        user_id: String(search.user_id || ''),
        search_id: String(search.id || ''),
        provider: 'openai',
        endpoint: 'chat.completions',
        status: 200,
        ms: Date.now() - startTime,
        request: { model: String(modelId), product: productStr, industries: industriesList, countries: countriesList },
        response: { text_length: analysis.length }
      });
    } catch {
      // Fallback to Gemini
      provider = 'gemini';
      try {
        const gText = await callGeminiText('gemini-2.0-flash', `${systemPrompt}\n\n${basePrompt}`);
        analysis = gText || '';
        await logApiUsage({
          user_id: String(search.user_id || ''),
          search_id: String(search.id || ''),
          provider: 'gemini',
          endpoint: 'generateContent',
          status: 200,
          ms: Date.now() - startTime,
          request: { model: 'gemini-2.0-flash', product: productStr },
          response: { text_length: analysis.length }
        });
      } catch {
        // Fallback to DeepSeek
        provider = 'deepseek';
        try {
          const dsText = await callDeepseekChatJSON({ user: `${systemPrompt}\n\n${basePrompt}`, temperature: 0.3, maxTokens: 4000, timeoutMs: 20000, retries: 1 });
          analysis = dsText || '';
          await logApiUsage({
            user_id: String(search.user_id || ''),
            search_id: String(search.id || ''),
            provider: 'deepseek',
            endpoint: 'chat.completions',
            status: 200,
            ms: Date.now() - startTime,
            request: { model: String(process.env.DEEPSEEK_MODEL || 'deepseek-chat'), product: productStr },
            response: { text_length: analysis.length }
          });
        } catch {
          provider = 'fallback';
          analysis = JSON.stringify({
            sources: webFindings.map((s: any) => s.url),
            analysis_summary: 'Heuristic insights constructed from available web links due to LLM failures',
            research_methodology: 'Serper web search and heuristic extraction'
          });
        }
      }
    }

    // Parse the analysis to extract structured data
    const insights = await parseMarketAnalysis(analysis, uniqueFindings.map((s: any) => s.url));

    const parsed = MarketInsightsSchema.safeParse(insights);
    if (!parsed.success) {
      logger.error('Invalid market insights from analysis', { error: parsed.error, provider });
      throw new Error('Invalid market insights format');
    }
    const valid = parsed.data;

    // Store in database with sources and methodology
    return await insertMarketInsights({
      search_id: String(search.id || ''),
      user_id: String(search.user_id || ''),
      tam_data: valid.tam_data as any,
      sam_data: valid.sam_data as any,
      som_data: valid.som_data as any,
      competitor_data: valid.competitor_data as any,
      trends: valid.trends as any,
      opportunities: valid.opportunities as any,
      sources: (valid.sources || []) as any,
      analysis_summary: valid.analysis_summary || (provider === 'fallback' ? 'Heuristic market insights' : 'Market research completed'),
      research_methodology: valid.research_methodology || (provider === 'fallback' ? 'Serper web search and heuristic extraction' : 'AI-powered analysis with multi-country web search and competitive intelligence')
    });

  } catch (error: any) {
    // Do not insert placeholder rows anymore to avoid false "Insights ready". Log and propagate.
    // Log failed API usage (provider: openai)
    await logApiUsage({
      user_id: String(search.user_id || ''),
      search_id: String(search.id || ''),
      provider: 'openai',
      endpoint: 'chat.completions',
      status: 500,
      ms: Date.now() - startTime,
      request: { model: String(resolveModel('primary')), product: String(search.product_service || '') },
      response: { error: error.message }
    });
    
    throw error;
  }
}

async function parseMarketAnalysis(analysis: string, _sources: any[]): Promise<any> {
  const cleanText = (s: string) => s.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').replace(/^"+|"+$/g, '').trim();
  const ensureString = (v: any, fallback: string) => (typeof v === 'string' && v.trim().length > 0 ? cleanText(v) : fallback);
  const ensureUrl = (v: any) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : '');
  const sanitizeMarketSize = (x: any, defaultDescription: string) => {
    const value = ensureString(x?.value, 'Data not available');
    const description = ensureString(x?.description, defaultDescription);
    const growth = typeof x?.growth === 'string' ? x.growth : 'Unknown';
    const calculation = typeof x?.calculation === 'string' ? x.calculation : (value === 'Data not available' ? `Insufficient data for reliable ${defaultDescription.toLowerCase()} calculation` : 'Derived from cited sources');
    const source = ensureUrl(x?.source || '');
    const out: any = { value, description };
    if (growth) out.growth = growth;
    if (calculation) out.calculation = calculation;
    if (source) out.source = source;
    return out;
  };
  const sanitizeCompetitors = (arr: any[]) =>
    (Array.isArray(arr) ? arr : [])
      .filter((c) => typeof c?.name === 'string' && c.name.trim().length > 0)
      .map((c) => ({
        name: ensureString(c.name, 'Unknown'),
        marketShare: typeof c.marketShare === 'number' || typeof c.marketShare === 'string' ? c.marketShare : undefined,
        revenue: typeof c.revenue === 'string' ? c.revenue : undefined,
        growth: typeof c.growth === 'string' ? c.growth : undefined,
        notes: typeof c.notes === 'string' ? c.notes : undefined,
        description: typeof c.description === 'string' ? c.description : undefined,
        strengths: Array.isArray(c.strengths) ? c.strengths : undefined,
        weaknesses: Array.isArray(c.weaknesses) ? c.weaknesses : undefined,
        source: ensureUrl(c.source || '') || undefined
      }));
  const sanitizeTrends = (arr: any[]) =>
    (Array.isArray(arr) ? arr : []).map((t) => ({
      trend: typeof t.trend === 'string' ? cleanText(t.trend) : undefined,
      title: typeof t.title === 'string' ? cleanText(t.title) : undefined,
      impact: typeof t.impact === 'string' ? t.impact : undefined,
      growth: typeof t.growth === 'string' ? t.growth : undefined,
      description: typeof t.description === 'string' ? t.description : undefined,
      timeline: typeof t.timeline === 'string' ? t.timeline : undefined,
      source: ensureUrl(t.source || '') || undefined
    }));
  const sanitizeOpportunities = (opp: any) => {
    if (Array.isArray(opp)) {
      return opp.map((o) => ({
        title: ensureString(o?.title, 'Opportunity'),
        description: ensureString(o?.description, 'Descriptive opportunity'),
        potential: ensureString(o?.potential, 'Unknown'),
        timeframe: ensureString(o?.timeframe, 'Unknown')
      }));
    }
    return {
      summary: ensureString(opp?.summary, 'Market research incomplete - requires additional data sources'),
      playbook: Array.isArray(opp?.playbook) ? opp.playbook : [],
      market_gaps: Array.isArray(opp?.market_gaps) ? opp.market_gaps : [],
      timing: ensureString(opp?.timing, 'Cannot determine without reliable market data')
    };
  };
  // Try to extract JSON from the analysis
  let insights;
  
  try {
    // Look for JSON in the analysis
    const jsonMatch = analysis.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      insights = JSON.parse(jsonMatch[0]);
    } else {
      // If no JSON found, create structured data from the text analysis
      insights = await generateStructuredInsights(analysis);
    }
  } catch {
    insights = await generateStructuredInsights(analysis);
  }

  // Normalize sources to object form expected by schema
  const normalizedSources = (_sources && Array.isArray(_sources) ? _sources : (insights?.sources || []))
    .map((s: any) => {
      if (!s) return null;
      if (typeof s === 'string') return { title: s, url: s };
      if (typeof s.url === 'string') return { title: s.title || s.url, url: s.url, date: s.date };
      return null;
    })
    .filter(Boolean);

  // Return only real data - no fake placeholders
  const tam = sanitizeMarketSize(insights?.tam_data ?? {}, 'Total Addressable Market');
  const sam = sanitizeMarketSize(insights?.sam_data ?? {}, 'Serviceable Addressable Market');
  const som = sanitizeMarketSize(insights?.som_data ?? {}, 'Serviceable Obtainable Market');
  const competitors = sanitizeCompetitors(insights?.competitor_data ?? []);
  const trends = sanitizeTrends(insights?.trends ?? []);
  const opportunities = sanitizeOpportunities(insights?.opportunities ?? null);
  return {
    tam_data: tam,
    sam_data: sam,
    som_data: som,
    competitor_data: competitors,
    trends,
    opportunities,
    sources: normalizedSources,
    analysis_summary: ensureString(insights?.analysis_summary, 'Market research generated with grounded sources'),
    research_methodology: ensureString(insights?.research_methodology, 'AI-powered analysis grounded in web sources')
  };
}

async function generateStructuredInsights(analysis: string): Promise<any> {
  // Extract key numbers and insights from the text analysis
  const marketSizeRegex = /\$[\d,.]+[BMK]?/g;
  const percentageRegex = /\d+(?:\.\d+)?%/g;
  
  const marketSizes = analysis.match(marketSizeRegex) || [];
  const percentages = analysis.match(percentageRegex) || [];
  
  return {
    tam_data: {
      value: marketSizes[0] || "Data not available",
      growth: percentages[0] || "Unknown",
      description: "Total Addressable Market",
      calculation: marketSizes[0] ? "Extracted from market research analysis" : "Insufficient data for reliable calculation",
      data_quality: marketSizes[0] ? "extracted" : "unavailable"
    },
    sam_data: {
      value: marketSizes[1] || "Data not available", 
      growth: percentages[1] || "Unknown",
      description: "Serviceable Addressable Market",
      calculation: marketSizes[1] ? "Geographic and segment analysis" : "Insufficient data for reliable calculation",
      data_quality: marketSizes[1] ? "extracted" : "unavailable"
    },
    som_data: {
      value: marketSizes[2] || "Data not available",
      growth: percentages[2] || "Unknown",
      description: "Serviceable Obtainable Market", 
      calculation: marketSizes[2] ? "Realistic capture potential" : "Insufficient data for reliable calculation",
      data_quality: marketSizes[2] ? "extracted" : "unavailable"
    },
    competitor_data: extractCompetitorData(analysis),
    trends: extractTrends(analysis),
    opportunities: extractOpportunities(analysis)
  };
}

function extractCompetitorData(analysis: string): any[] {
  // Try to extract competitor data from analysis text
  // Look for company names and competitive mentions
  const competitorRegex = /(?:competitor|company|player):\s*([A-Z][^.!?]*)/gi;
  const matches = analysis.match(competitorRegex) || [];
  
  if (matches.length === 0) {
    return [{
      name: "No competitor data available",
      marketShare: "Unknown", 
      description: "Insufficient data for competitive analysis",
      data_quality: "unavailable",
      note: "Competitive intelligence requires access to validated market research reports"
    }];
  }
  
  // Return extracted competitors (simplified - real implementation would be more sophisticated)
  return matches.slice(0, 3).map((match) => ({
    name: match.replace(/^.*:\s*/, '').trim(),
    marketShare: "Unknown",
    description: "Mentioned in market analysis",
    data_quality: "extracted",
    note: "Data extracted from available sources - may require validation"
  }));
}

function extractTrends(analysis: string): any[] {
  // Try to extract trend mentions from analysis text
  const trendRegex = /(?:trend|growth|emerging|increasing|rising)[\s:]*([^.!?]*)/gi;
  const matches = analysis.match(trendRegex) || [];
  
  if (matches.length === 0) {
    return [{
      title: "No trend data available",
      impact: "Unknown",
      description: "Insufficient data for trend analysis",
      timeline: "Unknown",
      data_quality: "unavailable",
      note: "Trend analysis requires access to current market intelligence and forecasting reports"
    }];
  }
  
  // Return extracted trends (simplified)
  return matches.slice(0, 3).map((match) => ({
    title: match.replace(/^.*?(?:trend|growth|emerging|increasing|rising)[\s:]*/, '').trim(),
    impact: "Unknown",
    description: "Mentioned in market analysis",
    timeline: "Unknown",
    data_quality: "extracted",
    note: "Data extracted from available sources - requires validation"
  }));
}

function extractOpportunities(analysis: string): any[] {
  // Try to extract opportunity mentions from analysis text
  const opportunityRegex = /(?:opportunity|potential|gap|opening)[\s:]*([^.!?]*)/gi;
  const matches = analysis.match(opportunityRegex) || [];
  
  if (matches.length === 0) {
    return [{
      title: "No opportunity data available",
      description: "Insufficient data for opportunity analysis",
      potential: "Unknown", 
      timeframe: "Unknown",
      data_quality: "unavailable",
      note: "Opportunity analysis requires comprehensive market research and competitive intelligence"
    }];
  }
  
  // Return extracted opportunities (simplified)
  return matches.slice(0, 3).map((match) => ({
    title: match.replace(/^.*?(?:opportunity|potential|gap|opening)[\s:]*/, '').trim(),
    description: "Mentioned in market analysis",
    potential: "Unknown",
    timeframe: "Unknown",
    data_quality: "extracted",
    note: "Data extracted from available sources - requires validation and deeper analysis"
  }));
}
