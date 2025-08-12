import { Agent, tool, run } from '@openai/agents';
import { serperPlaces } from '../tools/serper';
import logger from '../lib/logger';
import { resolveModel } from './clients';
import { insertBusinesses, updateSearchProgress, logApiUsage } from '../tools/db.write';

import { countryToGL, buildBusinessData } from '../tools/util';
import { mapBusinessesToPersonas } from '../tools/persona-mapper';
import { triggerInstantDMDiscovery, processBusinessForDM, initDMDiscoveryProgress } from '../tools/instant-dm-discovery';
import type { Business } from '../tools/instant-dm-discovery';

// Generate semantic variations of search queries using synonyms and industry jargon
// removed multi-query generator to enforce a single precise query flow per user request

const serperPlacesTool = tool({
  name: 'serperPlaces',
  description: 'Search Serper Places with a specified limit (max 15).',
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
      const capped = Math.max(1, Math.min(Number(limit) || 5, 15));
      const places = await serperPlaces(q, gl, capped);
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
          request: { q, gl, limit: capped, startTime },
          response: { count: places.length, endTime }
        });
      } catch (logError) {
      logger.warn('Failed to log API usage', { error: (logError as any)?.message || logError });
      }

      return { places };
    } catch (error: any) {
      const endTime = Date.now();
      // Use structured status if available on the error; fallback to 500
      const status = typeof error?.status === 'number' ? error.status : 500;

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
      logger.warn('Failed to log API usage', { error: (logError as any)?.message || logError });
      }

      logger.error('Serper Places API Error', { status, error: error.message || error });
      throw error;
    }
  }
});

// Enrichment removed for first paint speed; can be added later as a background step

const storeBusinessesTool = tool({
  name: 'storeBusinesses',
  description: 'Insert businesses with Gemini 2.0 Flash enrichment (departments/products/activity).',
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
    // Insert IMMEDIATELY without enrichment for fastest UI paint; enrichment can be handled later
    const capped = items.slice(0, 5);
    const rows = capped.map((b: Business) => buildBusinessData({
      search_id,
      user_id,
      persona_id: b.persona_id || null, // Use null if no persona mapping yet (will be updated later)
      name: b.name,
      industry,
      country,
      address: b.address || '',
      city: b.city || (b.address?.split(',')?.[0] || country),
      phone: b.phone || undefined,
      website: b.website || undefined,
      rating: b.rating ?? undefined,
      size: b.size || 'Unknown',
      revenue: b.revenue || 'Unknown',
      description: b.description || 'Business discovered via search',
      match_score: b.match_score || 75,
      persona_type: 'business_candidate',
      relevant_departments: b.relevant_departments || [],
      key_products: b.key_products || [],
      recent_activity: b.recent_activity || []
    }));
  logger.info('Inserting businesses', { count: rows.length, search_id });
    const insertedBusinesses = await insertBusinesses(rows);
    // Only increment the running DM discovery total with this batch if there are new businesses
    // Do not initialize here; we'll initialize within the batch trigger call to avoid double-counting
    // 🚀 PERSONA MAPPING (fire-and-forget)
  void mapBusinessesToPersonas(search_id).catch(err => logger.warn('Persona mapping failed', { error: err?.message || err }));

    // 🚀 INSTANT DM DISCOVERY: Trigger DM search for each business immediately
    // Initialize progress once for all inserted businesses
    if (insertedBusinesses.length > 0) {
      initDMDiscoveryProgress(search_id, insertedBusinesses.length);
    }
    const results = await Promise.allSettled(
      insertedBusinesses.map(async (business) => {
        return await processBusinessForDM(search_id, user_id, {
          ...business,
          country,
          industry
        });
      })
    );
    const succeededIds = new Set(
      results
        .map((r, idx) => (r.status === 'fulfilled' && r.value ? insertedBusinesses[idx].id : null))
        .filter(Boolean) as string[]
    );

    // Fallback: trigger batch discovery only for businesses not processed individually
    const pendingBusinesses = insertedBusinesses.filter(b => !succeededIds.has(b.id));
    if (pendingBusinesses.length > 0) {
      logger.debug('Triggering instant DM discovery (fallback)', { count: pendingBusinesses.length, search_id });
      await triggerInstantDMDiscovery(
        search_id,
        user_id,
        pendingBusinesses.map(b => ({ ...b, country, industry })),
        { initializeProgress: true }
      );
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
   serperPlaces(q=discovery_query, gl=gl, limit=5, search_id=search_id, user_id=user_id)

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
- Use limit=5 for maximum results
- Simple storage only - no complex analysis

MANDATORY FLOW (NO DEVIATIONS):
  User: "search_id=123 user_id=456 discovery_query='ev chargers sell automotive KSA' gl=sa"
  You: serperPlaces(q="ev chargers sell automotive KSA", gl="sa", limit=5, search_id="123", user_id="456")
  You: storeBusinesses("123", "456", "automotive", "KSA", converted_places_array)
DONE - NO MORE STEPS!

START NOW - NO WAITING!`,
  tools: [serperPlacesTool, storeBusinessesTool],
  handoffDescription: 'Discovers real businesses via Serper Places API and stores them immediately for fast results',
  handoffs: [],
  model: resolveModel('light')
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
  logger.debug('Processing business discovery with a single precise places query', { limit: 10 });

    // Build one precise discovery query from the first country to cap results to 10 places total
    const firstCountry = search.countries[0] || '';
    const gl = countryToGL(firstCountry || countries);
    // lens not used in simplified placesQuery, but kept for future prompt variants
    // Simpler query for Places API to maximize results
    const industry = (search.industries && search.industries[0]) ? search.industries[0] : '';
    const intent = search.search_type === 'customer' ? 'buyers need use purchase adopt' : 'vendors suppliers sell provide manufacture distribute';
    // Use full country name, not gl, inside the query text; gl is used for locale
    const placesQuery = `${search.product_service} ${industry} ${intent} ${firstCountry}`.trim();

    const msg = `search_id=${search.id} user_id=${search.user_id}
 - product_service=${search.product_service}
 - industries=${industries}
 - countries=${countries}
 - search_type=${search.search_type}
 
  MANDATE:
 - Call serperPlaces ONCE with q="${placesQuery}", gl="${gl}", limit=5, search_id="${search.id}", user_id="${search.user_id}"
  - Immediately call storeBusinesses with ALL returned places (cap 5) for industry="${industry || industries}", country="${firstCountry || countries}"
 - Do not perform additional place searches.
 
 NOTE: If serperPlaces returns 0 places, relax the query slightly (remove industry words) and try once more, then store results immediately if found.`;
    
  logger.info('Starting business discovery', { search_id: search.id, industries, countries });
    
    await run(BusinessDiscoveryAgent, [{ role: 'user', content: msg }]);
    // Deterministic safety: if fewer than 3 businesses were inserted, run a lighter relaxed retry
    try {
      const { data: countData } = await (await import('./clients')).supa
        .from('businesses')
        .select('id', { count: 'exact', head: true } as any)
        .eq('search_id', search.id);
      const count = (countData as any)?.length ?? 0;
      if (count < 3) {
        const firstCountry = search.countries[0] || '';
        const gl = countryToGL(firstCountry || countries);
        const relaxedQuery = `${search.product_service} ${firstCountry || countries}`.trim();
        const places = await (await import('../tools/serper')).serperPlaces(relaxedQuery, firstCountry || countries, 8).catch(() => []);
        if (Array.isArray(places) && places.length) {
          const rows = places.slice(0, 5).map((p: any) => buildBusinessData({
            search_id: search.id,
            user_id: search.user_id,
            persona_id: null,
            name: p.name,
            industry: search.industries[0] || 'General',
            country: firstCountry || countries,
            address: p.address || '',
            city: p.city || (p.address?.split(',')?.[0] || firstCountry || countries),
            phone: p.phone || undefined,
            website: p.website || undefined,
            rating: p.rating ?? undefined,
            size: 'Unknown',
            revenue: 'Unknown',
            description: 'Business discovered via relaxed search',
            match_score: 75,
            persona_type: 'business_candidate',
            relevant_departments: [],
            key_products: [],
            recent_activity: []
          }));
          if (rows.length) {
            await insertBusinesses(rows as any);
          }
        }
      }
    } catch {}
    await updateSearchProgress(search.id, 50, 'business_discovery');
  logger.info('Completed business discovery', { search_id: search.id });
  } catch (error) {
  logger.error('Business discovery failed', { search_id: search.id, error: (error as any)?.message || error });
    throw error;
  }
}
