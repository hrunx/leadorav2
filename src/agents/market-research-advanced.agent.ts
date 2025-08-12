// @ts-nocheck
import { GoogleGenerativeAI } from '@google/generative-ai';
import { serperSearch } from '../tools/serper';
import logger from '../lib/logger';
// import { logApiUsage } from '../tools/db.write';
import { glToCountryName } from '../tools/util';

  const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Tool for web search to gather market data
const webSearchTool = {
  name: 'web_search',
  description: 'Search the web for current market information, financial data, and industry insights',
  parameters: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string' as const,
        description: 'Search query to find market data'
      },
      focus: {
        type: 'string' as const,
        description: 'Focus area: market_size, competitors, trends, financial_data, industry_reports'
      }
    },
    required: ['query', 'focus']
  }
};

// Tool for market size calculation
const marketCalculatorTool = {
  name: 'calculate_market_size',
  description: 'Calculate TAM, SAM, SOM based on gathered data',
  parameters: {
    type: 'object' as const,
    properties: {
      industry: { type: 'string' as const },
      country: { type: 'string' as const },
      product_service: { type: 'string' as const },
      data_sources: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Sources of data used for calculation'
      },
      methodology: { type: 'string' as const, description: 'Calculation methodology' }
    },
    required: ['industry', 'country', 'product_service', 'data_sources', 'methodology']
  }
};

// Tool for competitor analysis
const competitorAnalysisTool = {
  name: 'analyze_competitors',
  description: 'Analyze competitive landscape with financial data',
  parameters: {
    type: 'object' as const,
    properties: {
      industry: { type: 'string' as const },
      country: { type: 'string' as const },
      search_queries: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Search queries used to find competitors'
      }
    },
    required: ['industry', 'country', 'search_queries']
  }
};

// Tool for trend analysis
const trendAnalysisTool = {
  name: 'analyze_trends',
  description: 'Analyze market trends and future opportunities',
  parameters: {
    type: 'object' as const,
    properties: {
      industry: { type: 'string' as const },
      time_horizon: { type: 'string' as const, description: '1-year, 3-year, 5-year' },
      focus_areas: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Areas to analyze: technology, regulations, consumer_behavior, etc.'
      }
    },
    required: ['industry', 'time_horizon', 'focus_areas']
  }
};

// Real web search function using Serper
async function performWebSearch(query: string, focus: string, countryCode: string): Promise<any[]> {
  // const startTime = Date.now();
  try {
    // Convert country code to proper country name for search query
    const countryName = glToCountryName(countryCode);
    let searchQuery = query;
    
    // Enhance query based on focus area and include proper country name
    if (focus === 'market_size') {
      searchQuery = `${query} market size ${countryName} market size value industry report 2024`;
    } else if (focus === 'competitors') {
      searchQuery = `${query} ${countryName} top companies market leaders competitors revenue`;
    } else if (focus === 'trends') {
      searchQuery = `${query} ${countryName} market trends forecast growth drivers 2024 2025`;
    } else if (focus === 'financial_data') {
      searchQuery = `${query} ${countryName} revenue financial performance investment funding`;
    } else if (focus === 'industry_reports') {
      searchQuery = `${query} ${countryName} industry analysis market research report`;
    }
    
  logger.debug('Market research web search', { q: searchQuery, focus });
    const resp = await serperSearch(searchQuery, countryCode, 5);
    const results = resp && resp.success ? resp.items : [];
    
    // Note: API usage logging will be handled by caller with proper user_id/search_id
    
    return results.map(r => ({
      title: r.title,
      snippet: r.snippet,
      url: r.link,
      source: new URL(r.link).hostname,
      focus_area: focus
    }));
    
  } catch (error: any) {
  logger.warn('Web search failed', { q: query, focus, error: (error as any)?.message });
    
    // Note: Error logging will be handled by caller
    
    return [];
  }
}

function extractMarketSizeFromSearch(searchResults: any[], args: any): any {
  const marketSizeRegex = /\$[\d,.]+[BMK]?/g;
  const percentageRegex = /\d+(?:\.\d+)?%/g;
  
  const allText = searchResults.map(r => `${r.title} ${r.snippet}`).join(' ');
  const marketSizes = allText.match(marketSizeRegex) || [];
  const percentages = allText.match(percentageRegex) || [];
  
  return {
    tam: marketSizes[0] || 'Market size data not found in search results',
    sam: marketSizes[1] || 'Segmentation data not available',
    som: marketSizes[2] || 'Obtainable market data not available',
    methodology: args?.methodology || 'Web search analysis of market reports and industry data',
    sources: searchResults.map(r => r.link).slice(0, 5),
    growth_rate: percentages[0] || 'Growth rate not specified',
    confidence: marketSizes.length > 0 ? 'medium' : 'low',
    note: marketSizes.length > 0 ? 'Market size extracted from industry sources' : 'Limited market data available from web search'
  };
}

function extractCompetitorsFromSearch(searchResults: any[]): any {
  // Extract company names and competitive information
  const competitors = [];
  const companyRegex = /\b[A-Z][a-zA-Z\s&]+(?:Inc|LLC|Corp|Company|Ltd|Group)\b/g;
  
  for (const result of searchResults.slice(0, 10)) {
    const text = `${result.title} ${result.snippet}`;
    const companies = text.match(companyRegex) || [];
    
    for (const company of companies.slice(0, 2)) {
      if (!competitors.find(c => c.name === company)) {
        competitors.push({
          name: company,
          source: result.link,
          description: result.snippet.substring(0, 100) + '...',
          found_in: result.title
        });
      }
    }
    
    if (competitors.length >= 5) break;
  }
  
  return {
    competitors: competitors,
    total_found: competitors.length,
    sources: searchResults.map(r => r.link).slice(0, 5),
    note: competitors.length > 0 ? 'Competitors identified from web search results' : 'No clear competitors found in search results',
    confidence: competitors.length >= 3 ? 'medium' : 'low'
  };
}

function extractTrendsFromSearch(searchResults: any[]): any {
  // Extract trends and market insights
  const trendKeywords = ['trend', 'growth', 'forecast', 'outlook', 'future', 'emerging', 'rising', 'increasing', 'adoption'];
  const trends = [];
  
  for (const result of searchResults.slice(0, 8)) {
    const text = `${result.title} ${result.snippet}`.toLowerCase();
    
    for (const keyword of trendKeywords) {
      if (text.includes(keyword)) {
        const sentences = result.snippet.split('.').filter(s => 
          s.toLowerCase().includes(keyword) && s.length > 20
        );
        
        for (const sentence of sentences.slice(0, 1)) {
          trends.push({
            description: sentence.trim(),
            source: result.link,
            confidence: 'medium',
            category: keyword,
            found_in: result.title
          });
        }
        break;
      }
    }
    
    if (trends.length >= 5) break;
  }
  
  return {
    trends: trends,
    total_found: trends.length,
    sources: searchResults.map(r => r.link).slice(0, 5),
    note: trends.length > 0 ? 'Market trends extracted from industry analysis' : 'Limited trend data available from web search',
    confidence: trends.length >= 3 ? 'medium' : 'low'
  };
}

export async function executeAdvancedMarketResearch(searchData: {
  product_service: string;
  industries: string[];
  countries: string[];
  search_id: string;
  user_id: string;
}) {
  const model = gemini.getGenerativeModel({
    model: 'gemini-2.0-flash-exp',
    tools: [{
      functionDeclarations: [
        webSearchTool,
        marketCalculatorTool,
        competitorAnalysisTool,
        trendAnalysisTool
      ]
    }],
    systemInstruction: `You are an expert market research analyst creating investor-grade market analysis. 

Your task is to:
1. Research the market thoroughly using web search
2. Calculate precise market sizes (TAM/SAM/SOM) with clear methodologies
3. Identify key competitors with market share data
4. Analyze trends and opportunities with timelines
5. Provide sources for all claims

Be extremely thorough and use multiple searches to gather comprehensive data. Think step by step through your analysis.

Product/Service: ${searchData.product_service}
Industries: ${searchData.industries.join(', ')}
Countries: ${searchData.countries.join(', ')}

Start by searching for market size data, then competitors, then trends. Build a complete picture across all specified industries and countries.`
  });

  const prompt = `Conduct comprehensive market research for ${searchData.product_service} across the ${searchData.industries.join(', ')} industries, focusing on ${searchData.countries.join(', ')}.

I need investor-grade analysis including:
1. Detailed market sizing (TAM/SAM/SOM) with calculation methodologies
2. Competitive landscape with market shares and financial performance
3. Key market trends and growth drivers
4. Investment opportunities and risks
5. Sources for all data points

Start by searching for current market data, then analyze competitors, and finally identify trends. Be thorough and provide specific numbers with sources.`;

  const chat = model.startChat();
  const result = await chat.sendMessage(prompt);

  // Handle function calls
  let finalResult = result;
  const functionCalls = result.response.functionCalls();
  let functionResponses = []; // Initialize outside if block
  
  if (functionCalls && functionCalls.length > 0) {
    functionResponses = await Promise.all(
      functionCalls.map(async (call) => {
        let response;
        
        switch (call.name) {
          case 'web_search':
            // Search across all countries for comprehensive results
            const allCountryResults = [];
            for (const country of searchData.countries) {
              const countryResults = await performWebSearch(call.args?.query, call.args?.focus, country);
              allCountryResults.push(...countryResults);
            }
            response = allCountryResults;
            break;
          case 'calculate_market_size':
            // Use actual web search data to estimate market size across all countries
            const allMarketResults = [];
            for (const country of searchData.countries) {
              const marketSearchResults = await performWebSearch(
                `${searchData.product_service} market size ${country} ${searchData.industries.join(' ')}`,
                'market sizing',
                country
              );
              allMarketResults.push(...marketSearchResults);
            }
            response = extractMarketSizeFromSearch(allMarketResults, call.args);
            break;
          case 'analyze_competitors':
            // Use web search for competitor analysis across all countries
            const allCompetitorResults = [];
            for (const country of searchData.countries) {
              const competitorSearchResults = await performWebSearch(
                `${searchData.product_service} competitors ${country} ${searchData.industries.join(' ')}`,
                'competitive analysis',
                country
              );
              allCompetitorResults.push(...competitorSearchResults);
            }
            response = extractCompetitorsFromSearch(allCompetitorResults);
            break;
          case 'analyze_trends':
            // Use web search for trend analysis across all countries
            const allTrendResults = [];
            for (const country of searchData.countries) {
              const trendSearchResults = await performWebSearch(
                `${searchData.product_service} trends ${country} ${searchData.industries.join(' ')} market outlook`,
                'trend analysis',
                country
              );
              allTrendResults.push(...trendSearchResults);
            }
            response = extractTrendsFromSearch(allTrendResults);
            break;
          default:
            response = { error: 'Unknown function' };
        }
        
        return {
          name: call.name,
          response
        };
      })
    );

    // Send function responses back to model
    const functionResponsesText = functionResponses.map(fr => 
      `Function ${fr.name} result: ${JSON.stringify(fr.response)}`
    ).join('\n\n');
    
    finalResult = await chat.sendMessage(`Based on the function results:\n\n${functionResponsesText}\n\nProvide a comprehensive market analysis.`);
  }

  // Aggregate all sources from function responses
  const allSources = [];
  if (functionCalls && functionCalls.length > 0) {
    functionResponses.forEach(fr => {
      if (fr.response && Array.isArray(fr.response)) {
        // For web search results
        fr.response.forEach(result => {
          if (result.url) allSources.push(result.url);
        });
      } else if (fr.response && fr.response.sources) {
        // For analysis results with sources
        allSources.push(...fr.response.sources);
      }
    });
  }

  return {
    analysis: finalResult.response.text(),
    functionCalls: functionCalls || [],
    sources: [...new Set(allSources)] // Remove duplicates
  };
}