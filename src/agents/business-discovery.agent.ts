import { Agent, tool, run } from '@openai/agents';
import { serperPlaces, serperSearch } from '../tools/serper';
import { insertBusinesses, updateSearchProgress, logApiUsage } from '../tools/db.write';
import { loadBusinessPersonas } from '../tools/db.read';
import { countryToGL, buildBusinessData } from '../tools/util';

import { gemini } from './clients';

const readPersonasTool = tool({
  name: 'readBusinessPersonas',
  description: 'Load persona ids and titles for bucketing.',
  parameters: { 
    type: 'object',
    properties: { 
      search_id: { type: 'string' }
    },
    required: ['search_id'],
    additionalProperties: false
  } as const,
  execute: async (input: unknown) => {
    const { search_id } = input as { search_id: string };
    return await loadBusinessPersonas(search_id);
  }
});

const serperPlacesTool = tool({
  name: 'serperPlaces',
  description: 'Search Serper Places, max 10.',
  parameters: { 
    type: 'object',
    properties: { 
      q: { type: 'string' },
      gl: { type: 'string' },
      limit: { type: 'number' },
      search_id: { type: 'string' },
      user_id: { type: 'string' }
    },
    required: ['q', 'gl', 'limit', 'search_id', 'user_id'],
    additionalProperties: false
  } as const,
  execute: async (input: unknown) => {
    const { q, gl, limit, search_id, user_id } = input as { q: string; gl: string; limit: number; search_id: string; user_id: string };
    const startTime = Date.now();
    try {
      const places = await serperPlaces(q, gl, limit);
      const endTime = Date.now();

      // Log API usage (with error handling)
      try {
        await logApiUsage({
          user_id,
          search_id,
          provider: 'serper',
          endpoint: 'places',
          status: 200,
          ms: endTime - startTime,
          request: { q, gl, limit, startTime },
          response: { count: places.length, endTime }
        });
      } catch (logError) {
        console.warn('Failed to log API usage:', logError);
      }

      return { places };
    } catch (error: any) {
      const endTime = Date.now();
      // Parse error status code from error message
      let status = 500;
      if (error.message?.includes('404')) status = 404;
      else if (error.message?.includes('401')) status = 401;
      else if (error.message?.includes('403')) status = 403;
      else if (error.message?.includes('429')) status = 429;

      // Log failed API usage with precise error details
      try {
        await logApiUsage({
          user_id,
          search_id,
          provider: 'serper',
          endpoint: 'places',
          status,
          ms: endTime - startTime,
          request: { q, gl, limit: limit || 10, startTime },
          response: { error: error.message, full_error: error.toString(), endTime }
        });
      } catch (logError) {
        console.warn('Failed to log API usage:', logError);
      }

      console.error(`Serper Places API Error (${status}):`, error.message);
      throw error;
    }
  }
});

const analyzeBusinessTool = tool({
  name: 'analyzeBusiness',
  description: 'Use Gemini AI to analyze a business and extract detailed company information including products, services, departments, and contact details.',
  parameters: {
    type: 'object',
    properties: {
      company_name: { type: 'string' },
      company_address: { type: 'string' },
      company_phone: { type: 'string' },
      company_website: { type: 'string' },
      search_context: { type: 'string' },
      country: { type: 'string' },
      search_id: { type: 'string' },
      user_id: { type: 'string' }
    },
    required: ['company_name', 'company_address', 'company_phone', 'company_website', 'search_context', 'country', 'search_id', 'user_id'],
    additionalProperties: false
  } as const,
  execute: async (input: unknown) => {
    const { 
      company_name, 
      company_address, 
      company_phone, 
      company_website, 
      search_context, 
      country, 
      search_id, 
      user_id 
    } = input as {
      company_name: string;
      company_address?: string;
      company_phone?: string;
      company_website?: string;
      search_context: string;
      country: string;
      search_id: string;
      user_id: string;
    };

    // First, search for more information about the company
    const searchQuery = `"${company_name}" ${country} products services contact information website`;
    const serperStartTime = Date.now();
    let searchResults;
    try {
      searchResults = await serperSearch(searchQuery, country, 5);
      const serperEndTime = Date.now();
      try {
        await logApiUsage({
          user_id,
          search_id,
          provider: 'serper',
          endpoint: 'web_search',
          status: 200,
          ms: serperEndTime - serperStartTime,
          request: { query: searchQuery, country, startTime: serperStartTime },
          response: { count: searchResults.length, endTime: serperEndTime }
        });
      } catch (logError) {
        console.warn('Failed to log API usage:', logError);
      }
    } catch (error: any) {
      const serperEndTime = Date.now();
      let status = 500;
      if (error.message?.includes('404')) status = 404;
      else if (error.message?.includes('401')) status = 401;
      else if (error.message?.includes('403')) status = 403;
      else if (error.message?.includes('429')) status = 429;
      try {
        await logApiUsage({
          user_id,
          search_id,
          provider: 'serper',
          endpoint: 'web_search',
          status,
          ms: serperEndTime - serperStartTime,
          request: { query: searchQuery, country, startTime: serperStartTime },
          response: { error: error.message, full_error: error.toString(), endTime: serperEndTime }
        });
      } catch (logError) {
        console.warn('Failed to log API usage:', logError);
      }
      console.error('Serper web search error:', error.message);
      throw error;
    }

    // Use Gemini to analyze and extract detailed company information
    const analysisPrompt = `
Analyze this company and extract detailed business information for sales prospecting purposes.

Company: ${company_name}
Address: ${company_address || 'Not provided'}
Phone: ${company_phone || 'Not provided'}
Website: ${company_website || 'Not provided'}
Country: ${country}
Search Context: ${search_context}

Additional Information from Web Search:
${searchResults.map((r: any) => `Title: ${r.title}\nSnippet: ${r.snippet}\nURL: ${r.link}`).join('\n\n')}

Extract and provide the following information in JSON format:
{
  "company_analysis": {
    "exact_products_services": ["specific product/service 1", "specific product/service 2", ...],
    "relevant_departments": ["department 1", "department 2", ...],
    "recent_activities": ["recent activity 1", "recent activity 2", ...],
    "company_size_estimate": "size estimate with reasoning",
    "revenue_estimate": "revenue estimate with reasoning",
    "industry_specific": "specific industry classification",
    "business_model": "description of how they make money",
    "key_challenges": ["challenge 1", "challenge 2", ...],
    "contact_information": {
      "email": "primary email if found",
      "website": "corrected/full website URL",
      "phone": "formatted phone number",
      "address": "complete address"
    },
    "decision_makers_likely": ["likely decision maker role 1", "likely decision maker role 2", ...],
    "match_reasoning": "why this company matches the search criteria"
  }
}

Requirements:
- Be specific and accurate based on available information
- If information is not available, use "Not available" rather than guessing
- Focus on information relevant to the search context: ${search_context}
- Provide realistic estimates based on company indicators
- Include contact information only if clearly found in the data
`;

      const model = gemini.getGenerativeModel({ model: 'gemini-1.5-pro' });
      const geminiStartTime = Date.now();
      try {
        const geminiResponse = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: analysisPrompt }] }]
        });
        const geminiEndTime = Date.now();

        const responseText = geminiResponse.response.text();


        // Log Gemini API usage
        try {
          await logApiUsage({
            user_id,
            search_id,
            provider: 'gemini',
            endpoint: 'generateContent',
            status: 200,
            ms: geminiEndTime - geminiStartTime,
            request: { company: company_name, analysis_type: 'business_details', startTime: geminiStartTime },
            response: { response_length: responseText.length, endTime: geminiEndTime }
          });
        } catch (logError) {
          console.warn('Failed to log API usage:', logError);
        }

        // Parse JSON response
        let analysis;
        try {
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            analysis = JSON.parse(jsonMatch[0]);
          }
        } catch (parseError) {
          console.error('Error parsing Gemini analysis response:', parseError);
          analysis = {
            company_analysis: {
              exact_products_services: [],
              relevant_departments: [],
              recent_activities: [],
              company_size_estimate: "Not available",
              revenue_estimate: "Not available",
              industry_specific: "General",
              business_model: "Not available",
              key_challenges: [],
              contact_information: {
                email: "Not available",
                website: company_website || "Not available",
                phone: company_phone || "Not available",
                address: company_address || "Not available"
              },
              decision_makers_likely: [],
              match_reasoning: "Basic match to search criteria",
            }
          };
        }

        return {
          company: company_name,
          analysis: analysis.company_analysis || analysis,
          raw_search_results: searchResults.length
        };
      } catch (error: any) {
        const geminiEndTime = Date.now();
        try {
          await logApiUsage({
            user_id,
            search_id,
            provider: 'gemini',
            endpoint: 'generateContent',
            status: 500,
            ms: geminiEndTime - geminiStartTime,
            request: { company: company_name, startTime: geminiStartTime },
            response: { error: error.message, endTime: geminiEndTime }
          });
        } catch (logError) {
          console.warn('Failed to log API usage:', logError);
        }

        console.error(`Business analysis error for ${company_name}:`, error);
        return {
          company: company_name,
          analysis: {
            exact_products_services: [],
            relevant_departments: [],
            recent_activities: [],
            company_size_estimate: "Analysis failed",
            revenue_estimate: "Analysis failed",
            industry_specific: "Unknown",
            business_model: "Unknown",
            key_challenges: [],
            contact_information: {
              email: "Not available",
              website: company_website || "Not available",
              phone: company_phone || "Not available",
              address: company_address || "Not available"
            },
            decision_makers_likely: [],
            match_reasoning: "Analysis error occurred"
          },
          error: error.message
        };
      }
    }
});

const storeBusinessesTool = tool({
  name: 'storeBusinesses',
  description: 'Insert businesses with complete analysis from Gemini AI.',
  parameters: { 
    type: 'object',
    properties: {
      search_id: { type: 'string' },
      user_id: { type: 'string' },
      industry: { type: 'string' },
      country: { type: 'string' },
      items: {
        type: 'array',
        items: { 
          type: 'object',
          properties: { 
            name: { type: 'string' },
            address: { type: 'string' },
            phone: { type: 'string' },
            website: { type: 'string' },
            rating: { type: 'number' },
            persona_id: { type: 'string' },
            persona_type: { type: 'string' },
            city: { type: 'string' },
            size: { type: 'string' },
            revenue: { type: 'string' },
            description: { type: 'string' },
            match_score: { type: 'number' },
            relevant_departments: { type: 'array', items: { type: 'string' } },
            key_products: { type: 'array', items: { type: 'string' } },
            recent_activity: { type: 'array', items: { type: 'string' } }
          },
          required: ['name', 'address', 'phone', 'website', 'rating', 'persona_id', 'persona_type', 'city', 'size', 'revenue', 'description', 'match_score', 'relevant_departments', 'key_products', 'recent_activity'],
          additionalProperties: false
        }
      }
    },
    required: ['search_id', 'user_id', 'industry', 'country', 'items'],
    additionalProperties: false
  } as const,
  execute: async (input: unknown) => {
    const { search_id, user_id, industry, country, items } = input as { 
      search_id: string; 
      user_id: string; 
      industry: string; 
      country: string; 
      items: any[] 
    };
    
    const rows = items.slice(0, 20).map((b: any) => buildBusinessData({
      search_id,
      user_id,
      persona_id: b.persona_id || null, // Use null if no persona mapping yet (will be updated later)
      name: b.name,
      industry,
      country,
      address: b.address || '',
      city: b.city || country,
      size: b.size || 'Unknown',
      revenue: b.revenue || 'Unknown',
      description: b.description || 'Business discovered via search',
      match_score: b.match_score || 75,
      persona_type: b.persona_type || 'business',
      relevant_departments: b.relevant_departments || [],
      key_products: b.key_products || [],
      recent_activity: b.recent_activity || []
    }));
    
    console.log(`Inserting ${rows.length} businesses for search ${search_id}`);
    return await insertBusinesses(rows);
  }
});

export const BusinessDiscoveryAgent = new Agent({
  name: 'BusinessDiscoveryAgent',
  instructions: `
You are a business discovery agent. Your job is to find real businesses using Serper Places API and store them in the database.

IMMEDIATE START PROCESS (no waiting for personas):
1. Start by calling serperPlaces to find businesses immediately (use limit: 10 for maximum results)
2. For each business found, call analyzeBusiness to get detailed information  
3. Try calling readBusinessPersonas to get persona information for mapping
4. Call storeBusinesses to save all businesses to database with persona mapping

CRITICAL RULES:
- START IMMEDIATELY with serperPlaces - don't wait for personas
- ALWAYS call serperPlaces with limit: 10 to get maximum businesses
- ALWAYS analyze EVERY business you find with analyzeBusiness
- If readBusinessPersonas fails or returns empty, use a default persona_id
- ALWAYS store ALL analyzed businesses with storeBusinesses
- Use the search_id and user_id provided in the user message
- Extract country and industry from the user message

IMMEDIATE WORKFLOW:
1. serperPlaces(q="[industry] companies in [country]", gl="[country_code]", limit=10, search_id, user_id)
2. For each place returned: analyzeBusiness(company details)
3. readBusinessPersonas(search_id) - for mapping (if available)
4. storeBusinesses(all analyzed businesses with persona mapping)

START FINDING BUSINESSES IMMEDIATELY - DON'T WAIT!`,
  tools: [readPersonasTool, serperPlacesTool, analyzeBusinessTool, storeBusinessesTool],
  handoffDescription: 'Discovers and analyzes real businesses with complete intelligence via Serper Places + Gemini AI',
  handoffs: [],
  model: 'gpt-4o-mini'
});

export async function runBusinessDiscovery(search: {
  id:string; 
  user_id:string; 
  product_service:string; 
  industries:string[]; 
  countries:string[]; 
  search_type:'customer'|'supplier'
}) {
  try {
    await updateSearchProgress(search.id, 30, 'business_discovery', 'in_progress');
    
    const countries = search.countries.join(', ');
    const industries = search.industries.join(', ');
    const gl = countryToGL(search.countries[0]); // Use first country for GL code
    const intent = search.search_type === 'customer' ? 'need' : 'sell provide';
    const q = `${search.product_service} ${intent} ${industries} ${countries}`;
    const msg = `search_id=${search.id} user_id=${search.user_id} 
- product_service=${search.product_service}
- industries=${industries}
- countries=${countries}
- search_type=${search.search_type}
- gl=${gl}
- discovery_query="${q}"

CRITICAL: Find businesses across ALL specified countries
- When calling serperPlaces you MUST pass limit: 10 (${countries}) and ALL specified industries (${industries}) that are relevant to "${search.product_service}". Use precise geographic targeting and industry filtering.`;
    
    console.log(`Starting business discovery for search ${search.id} | Industries: ${industries} | Countries: ${countries} | Query: "${q}"`);
    
    await run(BusinessDiscoveryAgent, [{ role: 'user', content: msg }]);
    
    await updateSearchProgress(search.id, 50, 'business_discovery_completed');
    console.log(`Completed business discovery for search ${search.id}`);
  } catch (error) {
    console.error(`Business discovery failed for search ${search.id}:`, error);
    throw error;
  }
}