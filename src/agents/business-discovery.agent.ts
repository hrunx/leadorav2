import { Agent, tool, run } from '@openai/agents';
import { serperPlaces, retryWithBackoff } from '../tools/serper';
import logger from '../lib/logger';
import { resolveModel } from './clients';
import { insertBusinesses, updateSearchProgress, logApiUsage } from '../tools/db.write';
import { loadBusinesses } from '../tools/db.read';

import { countryToGL, buildBusinessData } from '../tools/util';
import { mapBusinessesToPersonas } from '../tools/persona-mapper';
import { triggerInstantDMDiscovery, processBusinessForDM, initDMDiscoveryProgress } from '../tools/instant-dm-discovery';
import type { Business } from '../tools/instant-dm-discovery';
import pLimit from 'p-limit';

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
      const places = await retryWithBackoff(() => serperPlaces(q, gl, capped));
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
            industry: { type: 'string' },
            country: { type: 'string' },
            relevant_departments: { type: 'array', items: { type: 'string' } },
            key_products: { type: 'array', items: { type: 'string' } },
            recent_activity: { type: 'array', items: { type: 'string' } }
          },
          required: [
            'name',
            'address',
            'phone',
            'website',
            'rating',
            'persona_id',
            'persona_type',
            'city',
            'size',
            'revenue',
            'description',
            'match_score',
            'industry',
            'country',
            'relevant_departments',
            'key_products',
            'recent_activity'
          ],
          additionalProperties: false
        }
      }
    },
    required: ['search_id', 'user_id', 'items'],
    additionalProperties: false
  } as const,
  execute: async (input: unknown) => {

    const { search_id, user_id, industry, country, items } = input as {
      search_id: string;
      user_id: string;
      industry: string;
      country: string;
      items: Business[];
    };

    // Deduplicate by website/phone (case-insensitive):
    // - Seed sets with existing DB values for this search
    // - Skip items whose website or phone already exists in sets
    // - Add each unique website/phone to catch duplicates within the batch
    const existing = await loadBusinesses(search_id);
    const existingAny = (existing as any[]) || [];
    const seenWeb = new Set(
      existingAny.map((b: any) => String(b?.website || '').toLowerCase()).filter(Boolean)
    );
    const seenPhone = new Set(
      existingAny.map((b: any) => String(b?.phone || '').toLowerCase()).filter(Boolean)
    );
    const unique = items.filter(b => {
      const w = (b.website || '').toLowerCase();
      const p = (b.phone || '').toLowerCase();
      if (w && seenWeb.has(w)) return false;
      if (p && seenPhone.has(p)) return false;
      if (w) seenWeb.add(w);
      if (p) seenPhone.add(p);
      return true;
    });

    // After deduplication, insert immediately without enrichment for fastest UI paint
    const capped = unique.slice(0, 5);
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

    // Normalize nullables to satisfy insert typing
    const rowsForInsert = rows.map((r: any) => ({
      ...r,
      address: r.address ?? undefined,
      city: r.city ?? undefined,
      phone: r.phone ?? undefined,
      website: r.website ?? undefined,
      rating: typeof r.rating === 'number' ? r.rating : undefined,
      relevant_departments: Array.isArray(r.relevant_departments) ? r.relevant_departments : [],
      key_products: Array.isArray(r.key_products) ? r.key_products : [],
      recent_activity: Array.isArray(r.recent_activity) ? r.recent_activity : []
    }));

    // rows are already deduplicated; insert only new businesses
    logger.info('Inserting businesses', { count: rowsForInsert.length, search_id });
    const insertedBusinesses: any[] = await insertBusinesses(rowsForInsert as any);
    // 🚀 PERSONA MAPPING (fire-and-forget)
    void mapBusinessesToPersonas(search_id).catch(err => logger.warn('Persona mapping failed', { error: err?.message || err }));

    // Initialize DM discovery progress and update search progress once
    if (insertedBusinesses.length > 0) {
      initDMDiscoveryProgress(search_id, insertedBusinesses.length);
      await updateSearchProgress(search_id, 40, 'business_discovery');
    }

    // 🚀 INSTANT DM DISCOVERY: Trigger DM search for each business immediately with batching
    // Limit DM lookups to avoid hammering external APIs.
    // With a batch size of 3 and a 500ms gap, expected throughput is ~6 businesses/sec.
    const limit = pLimit(3);
    const batchSize = 3;
    const succeededIds = new Set<string>();

    for (let i = 0; i < insertedBusinesses.length; i += batchSize) {
      const batch = insertedBusinesses.slice(i, i + batchSize);

      await Promise.all(
        batch.map((business: any) =>
          limit(async () => {
            const ok = await processBusinessForDM(search_id, user_id, {
              ...business,
              country,
              industry
            });
            if (ok) {
              succeededIds.add(String(business.id));
            }
          })
        )
      );

      // simple backoff between batches to ease external API pressure
      if (i + batchSize < insertedBusinesses.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Fallback: trigger batch discovery only for businesses not processed individually
    const pendingBusinesses = insertedBusinesses.filter((b: any) => !succeededIds.has(String(b.id)));
    if (pendingBusinesses.length > 0) {
      logger.debug('Triggering instant DM discovery (fallback)', { count: pendingBusinesses.length, search_id });
      await triggerInstantDMDiscovery(
        search_id,
        user_id,
        pendingBusinesses as any,
        { initializeProgress: true }
      );
    }
    return insertedBusinesses;
  }
});

export const BusinessDiscoveryAgent = new Agent({
  name: 'BusinessDiscoveryAgent',
 instructions: `
You are a business discovery agent. Your job is to find real businesses based on search type and store them in the database.

SEARCH TYPE LOGIC:
- SUPPLIER searches: Find businesses that SELL, PROVIDE, or MANUFACTURE the product/service
- CUSTOMER searches: Find businesses that USE, REQUIRE, or BUY the product/service

STEP-BY-STEP PROCESS (execute in this exact order):

1. FIRST - Extract parameters from user message:
   - search_id, user_id (required)  
   - product_service, industries, countries, search_type
   - Build discovery_query based on search_type:
     * For SUPPLIER: "{product_service} supplier manufacturer sell {industry} {country}"
     * For CUSTOMER: "{product_service} buyer user client customer {industry} {country}"

2. SECOND - Call serperPlaces with optimized query:
   serperPlaces(q=discovery_query, gl=country_code, limit=8, search_id=search_id, user_id=user_id)

3. THIRD - IMMEDIATELY store ALL places from serperPlaces:
   storeBusinesses(search_id, user_id, all_places_as_basic_business_objects)

   CRITICAL: Convert each Serper place to this EXACT format:
   {
     name: place.name,
     address: place.address,
     phone: place.phone || null,
     website: place.website || null,
     rating: place.rating || null,
     city: place.city || place.location,
     industry: first_industry,
     country: first_country,
     size: "Unknown",
     revenue: "Unknown", 
     description: place.description || "Business discovered via Serper Places",
     match_score: 85,
     persona_id: null,
     persona_type: search_type, // "supplier" or "customer"
     relevant_departments: [],
     key_products: [product_service],
     recent_activity: []
   }

QUERY EXAMPLES:
- SUPPLIER search for "CRM software" in "Technology" in "USA":
  Query: "CRM software provider supplier vendor technology USA"
  
- CUSTOMER search for "CRM software" in "Technology" in "USA":
  Query: "CRM software user client customer technology companies USA"

CRITICAL SUCCESS RULES:
- MUST differentiate supplier vs customer searches
- MUST call serperPlaces with optimized query  
- MUST store ALL places immediately
- Use limit=8 for better coverage
- Set persona_type to search_type value

START NOW!`,
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
    logger.info('Business discovery: starting agent-based discovery', { 
      search_type: search.search_type,
      countries: search.countries.slice(0,3), 
      product_service: search.product_service 
    });

    // Use the BusinessDiscoveryAgent for primary discovery
    const countriesToSearch = (search.countries || []).slice(0, 3);
    const industry = search.industries?.[0] || '';
    
    // Build search-type specific discovery queries
    const buildDiscoveryQuery = (country: string) => {
      const baseQuery = `${search.product_service} ${industry} ${country}`;
      if (search.search_type === 'supplier') {
        return `${baseQuery} supplier manufacturer provider sell vendor`;
      } else {
        return `${baseQuery} buyer client customer user company`;
      }
    };

    // Try agent-based discovery first for each country
    for (const country of countriesToSearch) {
      const discoveryQuery = buildDiscoveryQuery(country);
      
      try {
        const agentMessage = `search_id=${search.id} user_id=${search.user_id} product_service="${search.product_service}" industries="${search.industries.join(', ')}" countries="${country}" search_type=${search.search_type} discovery_query="${discoveryQuery}" gl=${countryToGL(country)}`;
        
        await run(BusinessDiscoveryAgent, agentMessage);
        logger.info('Agent discovery completed for country', { country, search_type: search.search_type });
      } catch (agentError: any) {
        logger.warn('Agent discovery failed, falling back to manual search', { 
          country, 
          error: agentError.message 
        });
        // Fallback to manual search for this country
        await fallbackDiscovery(search, country, industry);
      }
    }

    // Check if we have sufficient results
    const businesses = await loadBusinesses(search.id);
    logger.info('Business discovery completed', { 
      total_businesses: businesses.length,
      search_type: search.search_type 
    });

    return businesses;

  } catch (error: any) {
    logger.error('Business discovery failed', { error: error.message });
    throw error;
  }
}

// Fallback discovery function for when agent fails
async function fallbackDiscovery(search: any, country: string, industry: string) {
  const { serperPlaces, retryWithBackoff } = await import('../tools/serper');
  
  try {
    // Build search-type specific queries
    const baseQuery = `${search.product_service} ${industry} ${country}`;
    const queries = search.search_type === 'supplier' 
      ? [
          `${baseQuery} supplier manufacturer provider`,
          `${baseQuery} vendor sell distributor`,
          `${search.product_service} company ${country}`
        ]
      : [
          `${baseQuery} buyer client customer`,
          `${baseQuery} user company business`,
          `${search.product_service} companies ${country}`
        ];

    const results: any[] = [];
    for (const q of queries) {
      // Try Serper Places
      const sp = await retryWithBackoff(() => serperPlaces(q, country, 8)).catch(() => [] as any[]);
      if (Array.isArray(sp) && sp.length) {
        results.push(...sp);
      }
      if (results.length >= 12) break;
    }

    // Store results if found
    if (results.length > 0) {
      const businessRows = results.map((place: any) => ({
        search_id: search.id,
        user_id: search.user_id,
        persona_id: null,
        name: place.name,
        address: place.address || undefined,
        phone: place.phone || undefined,
        website: place.website || undefined,
        rating: place.rating,
        city: place.city || country,
        industry: industry,
        country: country,
        size: "Unknown",
        revenue: "Unknown",
        description: place.description || "Business discovered via fallback search",
        match_score: 75,
        persona_type: search.search_type,
        relevant_departments: [],
        key_products: [search.product_service],
        recent_activity: []
      }));

      await insertBusinesses(businessRows);
      logger.info('Fallback discovery stored businesses', { 
        country, 
        count: businessRows.length,
        search_type: search.search_type 
      });
    }

  } catch (error: any) {
    logger.warn('Fallback discovery failed', { country, error: error.message });
  }
}
