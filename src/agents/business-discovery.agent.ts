import { Agent, tool, run } from '@openai/agents';
import { serperPlaces } from '../tools/serper';
import { insertBusinesses, updateSearchProgress, logApiUsage } from '../tools/db.write';

import { countryToGL, buildBusinessData } from '../tools/util';

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
You are a business discovery agent. Your ONLY job is to find real businesses and store them in the database.

STEP-BY-STEP PROCESS (execute in this exact order):

1. FIRST - Extract parameters from user message:
   - search_id, user_id (required)
   - product_service, industries, countries, gl
   - discovery_query (use this for serperPlaces)

2. SECOND - Call serperPlaces immediately:
   serperPlaces(q=discovery_query, gl=gl, limit=10, search_id=search_id, user_id=user_id)

3. THIRD - IMMEDIATELY store ALL places from serperPlaces:
   storeBusinesses(search_id, user_id, first_industry, first_country, all_places_as_basic_business_objects)
   
   CRITICAL: Convert each Serper place to this EXACT format:
   {
     name: place.name,
     address: place.address,
     phone: place.phone,
     website: place.website,
     rating: place.rating || 0,
     city: place.city,
     size: "Unknown",
     revenue: "Unknown", 
     description: "Business discovered via Serper Places",
     match_score: 85,
     persona_id: null,
     persona_type: "business",
     relevant_departments: [],
     key_products: [],
     recent_activity: []
   }

SKIP ANALYSIS COMPLETELY - JUST STORE BASIC BUSINESSES!

CRITICAL SUCCESS RULES:
- MUST call serperPlaces first with the discovery_query from user message  
- MUST store ALL places immediately (never skip this step!)
- SKIP analyzeBusiness completely (causes failures)
- Use limit=10 for maximum results
- Simple storage only - no complex analysis

MANDATORY FLOW (NO DEVIATIONS):
User: "search_id=123 user_id=456 discovery_query='ev chargers sell automotive SA' gl=sa"
You: serperPlaces(q="ev chargers sell automotive SA", gl="sa", limit=10, search_id="123", user_id="456")
You: storeBusinesses("123", "456", "automotive", "SA", converted_places_array)
DONE - NO MORE STEPS!

START NOW - NO WAITING!`,
  tools: [serperPlacesTool, storeBusinessesTool],
  handoffDescription: 'Discovers real businesses via Serper Places API and stores them immediately for fast results',
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
    // Process all target countries for comprehensive business discovery
  console.log(`Processing business discovery for countries: ${search.countries.join(', ')}`);
  const gl = countryToGL(search.countries[0]); // Primary country for GL code
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