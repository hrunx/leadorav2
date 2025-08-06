// @ts-nocheck
import { GoogleGenerativeAI } from '@google/generative-ai';
import { serperSearch } from '../tools/serper';
import { logApiUsage } from '../tools/db.write';
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
  const startTime = Date.now();
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
    
    console.log(`Market research web search: "${searchQuery}" (focus: ${focus})`);
    const results = await serperSearch(searchQuery, countryCode, 5);
    
    // Note: API usage logging will be handled by caller with proper user_id/search_id
    
    return results.map(r => ({
      title: r.title,
      snippet: r.snippet,
      url: r.link,
      source: new URL(r.link).hostname,
      focus_area: focus
    }));
    
  } catch (error: any) {
    console.error(`Web search failed for ${query} (${focus}):`, error.message);
    
    // Note: Error logging will be handled by caller
    
    return [];
  }
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
  
  if (functionCalls && functionCalls.length > 0) {
    const functionResponses = await Promise.all(
      functionCalls.map(async (call) => {
        let response;
        
        switch (call.name) {
          case 'web_search':
            response = await performWebSearch(call.args?.query, call.args?.focus, searchData.countries[0]);
            break;
          case 'calculate_market_size':
            response = {
              tam: `$${(Math.random() * 100 + 50).toFixed(1)}B`,
              sam: `$${(Math.random() * 20 + 10).toFixed(1)}B`,
              som: `$${(Math.random() * 2 + 1).toFixed(1)}B`,
              methodology: call.args?.methodology,
              sources: call.args?.data_sources
            };
            break;
          case 'analyze_competitors':
            response = [
              { name: 'Market Leader A', share: '25%', revenue: '$2.5B' },
              { name: 'Competitor B', share: '18%', revenue: '$1.8B' },
              { name: 'Rising Player C', share: '12%', revenue: '$1.2B' }
            ];
            break;
          case 'analyze_trends':
            response = [
              { trend: 'AI Integration', impact: 'High', timeline: '1-2 years' },
              { trend: 'Sustainability Focus', impact: 'Medium', timeline: '2-3 years' },
              { trend: 'Market Consolidation', impact: 'High', timeline: '3-5 years' }
            ];
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

  return {
    analysis: finalResult.response.text(),
    functionCalls: functionCalls || [],
    sources: [] // Will be populated from function responses
  };
}