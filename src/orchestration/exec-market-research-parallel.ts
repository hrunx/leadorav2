// import { executeAdvancedMarketResearch } from '../agents/market-research-advanced.agent';
import { openai, resolveModel } from '../agents/clients';
import { serperSearch } from '../tools/serper';
import { loadSearch } from '../tools/db.read';
import { insertMarketInsights, logApiUsage } from '../tools/db.write';

export async function execMarketResearchParallel(payload: {
  search_id: string;
  user_id: string;
}) {
  const search = await loadSearch(payload.search_id);
  if (!search) throw new Error(`Search ${payload.search_id} not found`);

  const searchData = {
    product_service: search.product_service,
    industries: search.industries || [],
    countries: search.countries || [],
    user_id: search.user_id,
    search_id: search.id
  };

  console.log(`Starting parallel market research for: ${searchData.product_service} in ${searchData.industries[0]} (${searchData.countries[0]})`);

  const startTime = Date.now();
  try {
    // Execute market research via OpenAI GPT-5
    const modelId = resolveModel('primary');

    // Pre-fetch web sources via Serper for each country (low token footprint: pass only URLs and short titles)
    const webFindings = (
      await Promise.all(
        (searchData.countries || []).slice(0, 3).map(async (country: string) => {
          const q = `${searchData.product_service} ${searchData.industries.join(' ')} market size competitors trends ${country}`;
          const r = await serperSearch(q, country, 4).catch(() => ({ success: false, items: [] } as any));
          return (r && (r as any).success ? (r as any).items : []).map((i: { title: string; link: string }) => ({ title: i.title, url: i.link }));
        })
      )
    ).flat().slice(0, 8);

    const sourcesForPrompt = webFindings.map(s => `- ${s.title} (${s.url})`).join('\n');
    const prompt = `Generate structured market insights JSON for ${searchData.product_service} targeting ${searchData.industries.join(', ')} in ${searchData.countries.join(', ')}.

Use ONLY valid JSON. Use these sources when relevant (do not quote text, just use as references):\n${sourcesForPrompt}`;
    const res = await openai.chat.completions.create({
      model: modelId,
      messages: [
        { role: 'system', content: 'You output ONLY valid JSON for market insights per the user spec.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
    });
    const analysis = res.choices?.[0]?.message?.content || '{}';

    // Log OpenAI API usage (provider: openai)
    await logApiUsage({
      user_id: search.user_id,
      search_id: search.id,
      provider: 'openai',
      endpoint: 'chat.completions',
      status: 200,
      ms: Date.now() - startTime,
      request: { model: modelId, product: searchData.product_service, industries: searchData.industries, countries: searchData.countries },
      response: { text_length: analysis.length }
    });

    // Parse the analysis to extract structured data
    const insights = await parseMarketAnalysis(analysis, webFindings.map(s => s.url));
    
    // Store in database with sources and methodology
    return await insertMarketInsights({
      search_id: search.id,
      user_id: search.user_id,
      tam_data: insights.tam_data || {},
      sam_data: insights.sam_data || {},
      som_data: insights.som_data || {},
      competitor_data: insights.competitor_data || [],
      trends: insights.trends || [],
      opportunities: insights.opportunities || {},
      sources: insights.sources || [],
      analysis_summary: insights.analysis_summary || 'Advanced market research completed',
      research_methodology: insights.research_methodology || 'AI-powered analysis with multi-country web search and competitive intelligence'
    });

  } catch (error: any) {
    console.error('Market research failed:', error.message);
    
    // Log failed API usage (provider: openai)
    await logApiUsage({
      user_id: search.user_id,
      search_id: search.id,
      provider: 'openai',
      endpoint: 'chat.completions',
      status: 500,
      ms: Date.now() - startTime,
      request: { 
        model: resolveModel('primary'),
        product: searchData.product_service,
        error: error.message
      },
      response: { error: error.message }
    });
    
    throw error;
  }
}

async function parseMarketAnalysis(analysis: string, _sources: any[]): Promise<any> {
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
  } catch (e) {
    console.log('JSON parsing failed, generating structured insights from text');
    insights = await generateStructuredInsights(analysis);
  }

  // Return only real data - no fake placeholders
  return {
    tam_data: insights.tam_data || {
      value: "Data not available",
      growth: "Unknown",
      description: "Total Addressable Market",
      calculation: "Insufficient data for reliable market size calculation",
      data_quality: "unavailable"
    },
    sam_data: insights.sam_data || {
      value: "Data not available", 
      growth: "Unknown",
      description: "Serviceable Addressable Market",
      calculation: "Insufficient data for reliable market segmentation",
      data_quality: "unavailable"
    },
    som_data: insights.som_data || {
      value: "Data not available",
      growth: "Unknown",
      description: "Serviceable Obtainable Market",
      calculation: "Insufficient data for realistic capture estimation",
      data_quality: "unavailable"
    },
    competitor_data: insights.competitor_data || [],
    trends: insights.trends || [],
    opportunities: insights.opportunities || {
      summary: "Market research incomplete - requires additional data sources",
      playbook: [],
      market_gaps: [],
      timing: "Cannot determine without reliable market data"
    },
    sources: _sources || insights.sources || [],
    analysis_summary: insights.analysis_summary || "Market research incomplete due to insufficient data",
    research_methodology: insights.research_methodology || "Limited data available - requires industry reports and market intelligence"
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