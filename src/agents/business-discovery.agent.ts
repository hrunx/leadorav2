import { Agent, tool, run } from '@openai/agents';
import { serperPlaces } from '../tools/serper';
import { insertBusinesses, updateSearchProgress, logApiUsage } from '../tools/db.write';

import { countryToGL, buildBusinessData } from '../tools/util';
import { triggerInstantDMDiscovery, processBusinessForDM, initDMDiscoveryProgress } from '../tools/instant-dm-discovery';
import type { Business } from '../tools/instant-dm-discovery';

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

// --- Helper: Enrich business data with plausible departments, products, and activity ---
function enrichBusiness(b: Business, industry: string, _country: string): Business {
  // Heuristic enrichment for demo purposes; in production, use LLM or a lookup table
  const departmentMap: Record<string, string[]> = {
    'automotive': ['Engineering', 'Sales', 'Procurement', 'R&D'],
    'energy': ['Operations', 'Finance', 'Sustainability', 'Engineering'],
    'software': ['Product', 'Engineering', 'Customer Success', 'Sales'],
    'default': ['Operations', 'Sales', 'Finance', 'HR']
  };
  const productMap: Record<string, string[]> = {
    'automotive': ['EV Chargers', 'Batteries', 'Motors'],
    'energy': ['Solar Panels', 'Wind Turbines', 'Batteries'],
    'software': ['CRM Platform', 'Analytics Suite', 'API Gateway'],
    'default': ['Consulting', 'Logistics', 'Support']
  };
  const activityMap: Record<string, string[]> = {
    'automotive': ['Launched new EV model', 'Expanded to new market'],
    'energy': ['Signed major supply contract', 'Opened new plant'],
    'software': ['Released major update', 'Partnered with SaaS vendor'],
    'default': ['Attended industry expo', 'Announced new partnership']
  };
  const key = (industry || '').toLowerCase();
  const departments = departmentMap[key] || departmentMap['default'];
  const products = productMap[key] || productMap['default'];
  const activities = activityMap[key] || activityMap['default'];
  return {
    ...b,
    relevant_departments: (b.relevant_departments && b.relevant_departments.length >= 2) ? b.relevant_departments : departments.slice(0, 2),
    key_products: (b.key_products && b.key_products.length >= 2) ? b.key_products : products.slice(0, 2),
    recent_activity: (b.recent_activity && b.recent_activity.length >= 1) ? b.recent_activity : [activities[0]]
  };
}

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
      items: Business[] 
    };
    // Enrich each business before DB insert
    const enriched: Business[] = items.slice(0, 20).map((b: Business) => enrichBusiness(b, industry, country));
    const rows = enriched.map((b: Business) => buildBusinessData({
      search_id,
      user_id,
      persona_id: b.persona_id || null, // Use null if no persona mapping yet (will be updated later)
      name: b.name,
      industry,
      country,
      address: b.address || '',
      city: b.city || country,
      phone: b.phone || undefined,
      website: b.website || undefined,
      rating: b.rating ?? undefined,
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
    const insertedBusinesses = await insertBusinesses(rows);
    // Increment the running DM discovery total with this batch
    initDMDiscoveryProgress(search_id, insertedBusinesses.length);
    // 🚀 INSTANT DM DISCOVERY: Trigger DM search for each business immediately as it is inserted
    const triggeredBusinessIds = new Set<string>();
    await Promise.all(
      insertedBusinesses.map(async (business) => {
        await processBusinessForDM(search_id, user_id, {
          ...business,
          country,
          industry
        });
        triggeredBusinessIds.add(business.id);
      })
    );

    // Fallback: trigger batch discovery only for businesses not processed individually
    const pendingBusinesses = insertedBusinesses.filter(b => !triggeredBusinessIds.has(b.id));
    if (pendingBusinesses.length > 0) {
      setTimeout(async () => {
        try {
          console.log(`🎯 (Fallback) Triggering instant DM discovery for ${pendingBusinesses.length} businesses`);
          await triggerInstantDMDiscovery(
            search_id,
            user_id,
            pendingBusinesses.map(b => ({ ...b, country, industry }))
          );
        } catch (error) {
          console.error('Failed to trigger instant DM discovery:', error);
        }
      }, 1000); // Small delay to ensure businesses are stored
    }
    return insertedBusinesses;
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
   
   CRITICAL: Convert each Serper place to this EXACT format (include ALL contact fields):
   {
     name: place.name,
     address: place.address,
     phone: place.phone || null,
     website: place.website || null,
     rating: place.rating || null,
     city: place.city || place.location,
     size: "Unknown",
     revenue: "Unknown", 
     description: place.description || "Business discovered via Serper Places",
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
    console.log(`Processing business discovery for countries: ${search.countries.join(', ')}`);
    
    // Generate better business search queries for each country
    const countrySearches = search.countries.map(country => {
      const gl = countryToGL(country);
      
      // Create multiple search patterns for better coverage
      const queries = [
        `${search.product_service} companies ${industries} ${country}`,
        `${search.product_service} suppliers ${industries}`,
        `${industries} companies ${search.product_service}`,
        `${search.product_service} manufacturers ${country}`
      ];
      
      return queries.map(query => 
        `  * serperPlaces(q="${query}", gl="${gl}", limit=10, search_id="${search.id}", user_id="${search.user_id}")`
      ).join('\n');
    }).join('\n');
    
    const msg = `search_id=${search.id} user_id=${search.user_id} 
- product_service=${search.product_service}
- industries=${industries}
- countries=${countries}
- search_type=${search.search_type}

BUSINESS SEARCH STRATEGY - Execute multiple searches for maximum coverage:
${countrySearches}

MULTI-SEARCH APPROACH:
- Run MULTIPLE serperPlaces searches with different query patterns
- Try various combinations: "companies", "suppliers", "manufacturers"
- Use proper GL codes for geographic targeting
- Collect ALL results from ALL searches
- Store combined results using storeBusinesses with complete contact info`;
    
    console.log(`Starting business discovery for search ${search.id} | Industries: ${industries} | Countries: ${countries}`);
    
    await run(BusinessDiscoveryAgent, [{ role: 'user', content: msg }]);
    
    await updateSearchProgress(search.id, 50, 'business_discovery_completed');
    console.log(`Completed business discovery for search ${search.id}`);
  } catch (error) {
    console.error(`Business discovery failed for search ${search.id}:`, error);
    throw error;
  }
}
