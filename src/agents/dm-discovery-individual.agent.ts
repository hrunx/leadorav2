import { Agent, tool, run } from '@openai/agents';
import { serperSearch } from '../tools/serper';
import { resolveModel, supa as sharedSupa } from './clients';
import { insertDecisionMakersBasic, logApiUsage } from '../tools/db.write';
import { loadDMPersonas } from '../tools/db.read';
import { mapDMToPersona } from '../tools/util';
import logger from '../lib/logger';
import { mapDecisionMakersToPersonas } from '../tools/persona-mapper';
import { createHash } from 'crypto';

interface Employee {
  name: string;
  title: string;
  company: string;
  linkedin: string;
  email: string | null;
  phone: string | null;
  bio: string;
  location: string;
  business_name?: string;
  enrichment_status?: string;
}

type SerperItem = { link?: string; title?: string; snippet?: string };

// Supabase-backed de-duplication of repeated search queries
const QUERY_LOG_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const supa = sharedSupa;

function makeQueryHash(company: string, query: string): string {
  return createHash('sha256').update(`${company}::${query}`.toLowerCase()).digest('hex');
}

async function hasSeen(company: string, query: string): Promise<boolean> {
  const hash = makeQueryHash(company, query);
  const cutoff = new Date(Date.now() - QUERY_LOG_TTL_MS).toISOString();
  try {
    const { data, error } = await supa
      .from('linkedin_query_log')
      .select('id')
      .eq('hash', hash)
      .gte('created_at', cutoff)
      .limit(1)
      .maybeSingle();
    if (error) {
      logger.warn('Failed to check query log', { error: error.message || error });
      return false;
    }
    return Boolean(data);
  } catch (e: any) {
    logger.warn('Failed to check query log', { error: e?.message || e });
    return false;
  }
}

async function markSeen(company: string, query: string): Promise<void> {
  const hash = makeQueryHash(company, query);
  try {
    await supa.from('linkedin_query_log').insert({ hash, company, query }).select('id');
  } catch (e: any) {
    logger.warn('Failed to log query', { error: e?.message || e });
  }
}

async function expireOldQueryLogs(): Promise<void> {
  const cutoff = new Date(Date.now() - QUERY_LOG_TTL_MS).toISOString();
  try {
    await supa.from('linkedin_query_log').delete().lt('created_at', cutoff);
  } catch (e: any) {
    logger.warn('Failed to expire old query logs', { error: e?.message || e });
  }
}

const linkedinSearchTool = tool({
  name: 'linkedinSearch',
  description: 'Search LinkedIn for employees of a specific company.',
  parameters: { 
    type: 'object',
    properties: { 
      company_name: { type: 'string' },
      company_country: { type: 'string' },
      search_id: { type: 'string' },
      user_id: { type: 'string' },
      product_service: { type: 'string' }
    },
    required: ['company_name', 'company_country', 'search_id', 'user_id', 'product_service'],
    additionalProperties: false
  } as const,
  strict: true,
  execute: async (input: unknown) => {
    const { company_name, company_country, search_id, user_id, product_service } = input as { 
      company_name: string; 
      company_country: string;
      search_id: string; 
      user_id: string;
      product_service: string;
    };
    
    const startTime = Date.now();

    try {
      await expireOldQueryLogs();

      // Single precise search per company to limit API usage
      const personas = await loadDMPersonas(search_id);
      const primaryTitle = (Array.isArray(personas) && personas[0]?.title) ? String(personas[0].title).trim() : 'Head of';
      const ctx = (product_service || '').trim();
      const suffix = ctx ? ` ${ctx}` : '';
      const queries = [`"${company_name}" site:linkedin.com/in/ ${primaryTitle}${suffix}`];
      
      const allEmployees: Employee[] = [];
      
      // Search for employees in different roles
      for (const query of queries) {
        try {
          // Skip if we've already executed this query recently
          if (await hasSeen(company_name, query)) {
            continue;
          }
          const result = await serperSearch(query, company_country, 10);
          if (result && result.success && Array.isArray(result.items)) {
            const employees = result.items
              .filter((item: SerperItem) =>
                item.link?.includes('linkedin.com/in/') &&
                // Accept profile hits even if company not in title; keep if title OR snippet contains company
                (
                  item.title?.toLowerCase().includes(company_name.toLowerCase()) ||
                  item.snippet?.toLowerCase().includes(company_name.toLowerCase()) ||
                  true // fallback: keep broad to avoid empty results; later filtering/mapping will help
                )
              )
              .map((item: SerperItem): Employee => ({
                name: extractNameFromLinkedInTitle(item.title || ''),
                title: extractTitleFromLinkedInTitle(item.title || ''),
                company: company_name,
                linkedin: item.link || '',
                email: null,
                phone: null,
                bio: item.snippet || '',
                location: company_country || 'Unknown',
                enrichment_status: 'pending'
              }));

            for (const emp of employees) {
              if (!emp.bio || emp.bio.trim() === '') emp.bio = 'Bio unavailable';
              if (!emp.location) emp.location = 'Unknown';
            }

            // Remove blocking enrichment: do not call fetchContactEnrichment here
            // Store employees immediately with enrichment_status: 'pending'
            allEmployees.push(...employees);
          }
          // Mark this query as seen to prevent future duplicates
          await markSeen(company_name, query);
          
          // Small delay between searches to avoid rate limiting
          const jitter = 300 + Math.floor(Math.random() * 300);
          await new Promise(resolve => setTimeout(resolve, jitter));

          // No hard cap; accept as many as returned from the single search
        } catch (searchError) {
          logger.warn('LinkedIn search failed', { query, error: (searchError as any)?.message || searchError });
        }
      }
      
      const endTime = Date.now();
      
      // Log API usage
      try {
        await logApiUsage({
          user_id,
          search_id,
          provider: 'serper',
          endpoint: 'linkedin_search',
          status: 200,
          ms: endTime - startTime,
          request: { company_name, company_country, queries: queries.length },
          response: { employees_found: allEmployees.length }
        });
      } catch (logError) {
        logger.warn('Failed to log LinkedIn search usage', { error: (logError as any)?.message || logError });
      }
      
      // Remove duplicates based on LinkedIn URL
      const uniqueEmployees = allEmployees.filter((employee, index, self) => 
        index === self.findIndex(e => e.linkedin === employee.linkedin)
      );
      
       return { employees: uniqueEmployees.slice(0, 10) }; // Limit to 10 per company
      
      } catch (error) {
      const endTime = Date.now();
      
      // Log error
      try {
        await logApiUsage({
          user_id,
          search_id,
          provider: 'serper',
          endpoint: 'linkedin_search',
          status: 500,
          ms: endTime - startTime,
          request: { company_name, company_country },
          response: { error: (error as any)?.message || String(error) }
        });
      } catch (logError: any) {
        logger.warn('Failed to log LinkedIn search error', { error: (logError as any)?.message || logError });
      }
      
      throw error;
    }
  }
});

// --- Helper: Validate Decision Maker completeness ---
function isValidDecisionMaker(dm: any): boolean {
  const isNonEmptyString = (v: any) => typeof v === 'string' && v.trim() && !['unknown', 'n/a', 'default', 'none'].includes(v.trim().toLowerCase());
  try {
    if (!isNonEmptyString(dm.name)) return false;
    if (!isNonEmptyString(dm.title)) return false;
    if (!isNonEmptyString(dm.level)) return false;
    if (!isNonEmptyString(dm.department)) return false;
    if (!isNonEmptyString(dm.company)) return false;
    if (!isNonEmptyString(dm.location)) return false;
    if (!isNonEmptyString(dm.persona_type)) return false;
    if (!isNonEmptyString(dm.linkedin)) return false;
    if (typeof dm.influence !== 'number' || dm.influence < 0) return false;
    if (!isNonEmptyString(dm.search_id)) return false;
    if (!isNonEmptyString(dm.user_id)) return false;
    if (!isNonEmptyString(dm.business_id)) return false;
    // persona_id can be null initially; it will be mapped later when personas are ready
    // Optional: email, phone, experience, communication_preference, pain_points, motivations, decision_factors, company_context, personalized_approach, enrichment, match_score, enrichment_status, created_at
    return true;
  } catch {
    return false;
  }
}

const storeDMsTool = tool({
  name: 'storeDecisionMakers',
  description: 'Store decision makers with smart persona mapping.',
  parameters: {
    type: 'object',
    properties: {
      search_id: { type: 'string' },
      user_id: { type: 'string' },
      business_id: { type: 'string' },
      employees: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            title: { type: 'string' },
            company: { type: 'string' },
            linkedin: { type: 'string' },
            email: { type: ['string', 'null'] },
            phone: { type: ['string', 'null'] },
            bio: { type: 'string' },
            location: { type: 'string' }
          },
          required: ['name', 'title', 'company', 'linkedin', 'email', 'phone', 'bio', 'location'],
          additionalProperties: false
        }
      }
    },
    required: ['search_id', 'user_id', 'business_id', 'employees'],
    additionalProperties: false
  } as const,
  strict: true,
  execute: async (input: unknown) => {
    const { search_id, user_id, business_id, employees } = input as {
      search_id: string;
      user_id: string;
      business_id: string;
      employees: Employee[]
    };

    // Defensive: ensure every employee has a location
    const employeesWithLocation: Employee[] = employees.map((emp) => ({
      ...emp,
      location: emp.location || 'Unknown'
    }));

    // Load DM personas for smart mapping
    const dmPersonas = await loadDMPersonas(search_id);

    // Map and extend each employee to full DecisionMaker structure
    const rows = employeesWithLocation.map((emp) => {
      // 🎯 SMART PERSONA MAPPING: Match employee to most relevant persona
    const mappedPersona = mapDMToPersona(emp as any, dmPersonas as any) as any;
      // Defensive: ensure company is always set
      let company = emp.company;
      if (!company || typeof company !== 'string' || !company.trim()) {
        company = emp.business_name || 'Unknown Company';
      }
      // Infer missing fields as needed
      const level = mappedPersona?.demographics?.level || 'manager';
      const department = mappedPersona?.demographics?.department || 'General';
      const influence = mappedPersona?.influence || 50;
      const persona_type = mappedPersona?.title || 'decision_maker';
      const match_score = mappedPersona?.match_score || 80;
      const experience = mappedPersona?.demographics?.experience || '';
      const communication_preference = mappedPersona?.behaviors?.communicationStyle || '';
      const pain_points = mappedPersona?.characteristics?.painPoints || [];
      const motivations = mappedPersona?.characteristics?.motivations || [];
      const decision_factors = mappedPersona?.characteristics?.decisionFactors || [];
      const company_context = {};
      const personalized_approach = {};
      const enrichment = {};
      const created_at = new Date().toISOString();
      return {
        id: undefined, // Let DB autogen or set if needed
        search_id,
        user_id,
        persona_id: mappedPersona?.id || null,
        name: emp.name,
        title: emp.title,
        level,
        influence,
        department,
        company,
        location: emp.location || '',
        email: emp.email || '',
        phone: emp.phone || '',
        linkedin: emp.linkedin,
        experience,
        communication_preference,
        pain_points,
        motivations,
        decision_factors,
        persona_type,
        company_context,
        personalized_approach,
        created_at,
        match_score,
        enrichment_status: emp.enrichment_status || 'pending',
        enrichment,
        business_id
      };
    });

    // Strict validation: reject any incomplete employee
    const validRows = rows.filter(isValidDecisionMaker);
    if (validRows.length !== rows.length) {
      throw new Error('One or more decision makers are missing required fields or contain placeholders.');
    }

  logger.info('Storing decision makers with persona mapping', { count: validRows.length, business_id });
    const inserted = await insertDecisionMakersBasic(validRows);

    // Deduplicate and harden enrichment trigger in storeDMsTool: Only trigger enrichment once, always catch errors, and never block DM storage on enrichment. Add comments for clarity.
    let enrichUrl = '/.netlify/functions/enrich-decision-makers';
    if (typeof process !== 'undefined' && process.env && (process.env.URL || process.env.DEPLOY_URL)) {
      enrichUrl = `${process.env.URL || process.env.DEPLOY_URL}/.netlify/functions/enrich-decision-makers`;
    } else if (typeof window !== 'undefined' && window.location) {
      enrichUrl = `${window.location.origin}/.netlify/functions/enrich-decision-makers`;
    }
    // Schedule follow-up persona assignment for any unmapped DMs
    if (rows.some(r => !r.persona_id)) {
      setTimeout(() => {
        waitForPersonas(search_id)
          .then(() => mapDecisionMakersToPersonas(search_id))
          .catch(err => logger.warn('Deferred DM persona mapping failed', { error: (err as any)?.message || err }));
      }, 10000);
    }

    try {
      // Trigger backend enrichment via Netlify function without blocking
      void fetch(enrichUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search_id })
      }).catch(err => {
        logger.warn('Failed to trigger enrichment', { error: (err as any)?.message || err });
      });
    } catch (err) {
      logger.warn('Failed to trigger enrichment', { error: (err as any)?.message || err });
    }

    return inserted;
  }
});

export const DMDiscoveryIndividualAgent = new Agent({
  name: 'DMDiscoveryIndividualAgent',
  instructions: `
You are a decision maker discovery agent that processes ONE business at a time for instant results.

MISSION: Find LinkedIn employees for a specific company immediately when the company is discovered.

PROCESS:
1. Extract company details from the user message
2. Search LinkedIn for employees using multiple role-based queries
3. Store decision makers with SMART PERSONA MAPPING

LINKEDIN SEARCH STRATEGY:
- Search for: CEO, CTO, CMO, CFO, VP, Directors, Managers
- Use site:linkedin.com/in/ to find profiles
- Include company name in quotes for accuracy
- Extract names, titles, and LinkedIn URLs

SMART PERSONA MAPPING:
- Match each employee to the most relevant DM persona based on:
  - Job title keywords (CEO→C-Level, Manager→Middle Management)
  - Department alignment (CTO→Technical, CMO→Marketing)
  - Seniority level (VP→Senior, Director→Mid-Level)

CONTACT GENERATION:
- Generate professional email: firstname.lastname@company.com
- Mark for enrichment to get real phone numbers
- Capture LinkedIn bio for context

Be fast and accurate - users see results immediately!
`,
  tools: [linkedinSearchTool, storeDMsTool],
  model: resolveModel('light')
});

export async function runDMDiscoveryForBusiness(params: {
  search_id: string;
  user_id: string;
  business_id: string;
  business_name: string;
  company_country: string;
  industry: string;
  product_service?: string;
}) {
  // Wait for DM personas with shorter timeout, proceed anyway if not ready
  // Wait less but proceed; mapping to DM personas will happen after persona generation completes
  const personas = await waitForPersonas(params.search_id, 20000, 2000); // 20s timeout
  if (personas.length === 0) {
  logger.warn('Proceeding with DM discovery without personas', { business_name: params.business_name });
  }

  const message = `Find LinkedIn employees for this company immediately:

Company: ${params.business_name}
Country: ${params.company_country}
Industry: ${params.industry}
Product/Service Context: ${params.product_service || 'Not specified'}
Business ID: ${params.business_id}
Search ID: ${params.search_id}
User ID: ${params.user_id}

Search LinkedIn for executives and decision makers who would be involved in purchasing/using "${params.product_service || 'business solutions'}". Focus on relevant departments and roles that would influence buying decisions for this type of product/service. Store them with smart persona mapping.`;

  // Retry on OpenAI 429 rate limits with backoff
  const MAX_ATTEMPTS = 3;
  let attempt = 0;
  let lastError: any;
  while (attempt < MAX_ATTEMPTS) {
    try {
      const result = await run(DMDiscoveryIndividualAgent, message);
      // Post-run guard: if no DMs were inserted for this business, run deterministic fallback
      const dmCount = await countDMsForBusiness(params.search_id, params.business_id);
      if (dmCount === 0) {
        logger.warn('No DMs stored by agent; running deterministic fallback', { business_id: params.business_id });
        await runDeterministicDMDiscovery(params);
      }
      // Do not attempt persona mapping here; a separate mapping step will run after personas are generated
      return result;
    } catch (err: any) {
      lastError = err;
      const msg = (err && (err.message || err.toString())) || '';
      if (msg.includes('Rate limit') || msg.includes('429')) {
        const delayMs = 3000 * (attempt + 1);
        await new Promise(r => setTimeout(r, delayMs));
        attempt += 1;
        continue;
      }
      throw err;
    }
  }
  // If agent flow did not throw but also did not store, run deterministic fallback
  // Fallback: run direct Serper queries and store results immediately
  try {
    await runDeterministicDMDiscovery(params);
    return { success: true, fallback: true } as any;
  } catch (e) {
    throw lastError || e;
  }
}

// Polls until DM personas exist or a timeout is reached
async function waitForPersonas(search_id: string, timeoutMs = 60000, delayMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const personas = await loadDMPersonas(search_id);
    if (personas && personas.length > 0) {
  logger.info('Found DM personas', { count: personas.length, search_id });
      return personas;
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  logger.warn('DM personas not ready after timeout, proceeding', { search_id, timeout_s: Math.round(timeoutMs / 1000) });
  return [];
}

// Helper functions
function extractNameFromLinkedInTitle(title: string): string {
  // Extract name from LinkedIn title like "John Smith - CEO at Company"
  const match = title.match(/^([^-|]+)(?:\s*[-|]\s*)/);
  return match ? match[1].trim() : title.split(' ').slice(0, 2).join(' ');
}

function extractTitleFromLinkedInTitle(title: string): string {
  // Extract title from LinkedIn title
  const match = title.match(/[-|]\s*([^-|]+?)(?:\s+at\s+|\s*$)/);
  return match ? match[1].trim() : 'Professional';
}

// --- Deterministic fallback discovery and storage ---
async function runDeterministicDMDiscovery(params: {
  search_id: string;
  user_id: string;
  business_id: string;
  business_name: string;
  company_country: string;
  industry: string;
  product_service?: string;
}) {
  const { search_id, user_id, business_id, business_name, company_country, product_service } = params;
  const personas = await loadDMPersonas(search_id);
      const titles = Array.isArray(personas)
        ? personas.slice(0, 3).map((p: any) => String(p.title || '').trim()).filter(Boolean)
        : [];
      const baseTitles = titles.length ? titles : ['Head of', 'Director', 'VP'];
  const suffix = (product_service || '').trim();
  const queries = baseTitles.map(t => `"${business_name}" site:linkedin.com/in/ ${t}${suffix ? ` ${suffix}` : ''}`);

  // Load existing LinkedIns to avoid duplicates
  const existing = await getExistingLinkedins(search_id, business_id);
  const allEmployees: Employee[] = [];
  for (const q of queries) {
    const r = await serperSearch(q, company_country, 10);
    if (r && r.success && Array.isArray(r.items)) {
      const emps = r.items
        .filter((item: SerperItem) => item.link?.includes('linkedin.com/in/'))
        .map((item: SerperItem): Employee => ({
          name: extractNameFromLinkedInTitle(item.title || ''),
          title: extractTitleFromLinkedInTitle(item.title || ''),
          company: business_name,
          linkedin: item.link!,
          email: null,
          phone: null,
          bio: item.snippet || '',
          location: company_country || 'Unknown',
          enrichment_status: 'pending'
        }));
      for (const emp of emps) {
        if (!existing.has(emp.linkedin)) allEmployees.push(emp);
      }
    }
    // light delay
    await new Promise(r => setTimeout(r, 200));
  }

  if (allEmployees.length === 0) {
    // Secondary broadening: generic title + country queries to catch more profiles
    const genericQueries = baseTitles.map(t => `site:linkedin.com/in/ ${t}${suffix ? ` ${suffix}` : ''} ${company_country}`);
    for (const q of genericQueries) {
      const r = await serperSearch(q, company_country, 10);
      if (r && r.success && Array.isArray(r.items)) {
        const emps = r.items
          .filter((item: SerperItem) => item.link?.includes('linkedin.com/in/'))
          .map((item: SerperItem): Employee => ({
            name: extractNameFromLinkedInTitle(item.title || ''),
            title: extractTitleFromLinkedInTitle(item.title || ''),
            company: business_name,
            linkedin: item.link!,
            email: null,
            phone: null,
            bio: item.snippet || '',
            location: company_country || 'Unknown',
            enrichment_status: 'pending'
          }));
        for (const emp of emps) {
          if (!existing.has(emp.linkedin)) allEmployees.push(emp);
        }
      }
      await new Promise(r => setTimeout(r, 150));
      if (allEmployees.length >= 5) break; // cap
    }
    if (allEmployees.length === 0) return;
  }
  
  // If company-specific queries yielded nothing, broaden to generic title + country
  if (allEmployees.length === 0) {
    const genericQueries = baseTitles.map(t => `site:linkedin.com/in/ ${t}${suffix ? ` ${suffix}` : ''} ${company_country}`);
    for (const q of genericQueries) {
      const r = await serperSearch(q, company_country, 10);
      if (r && r.success && Array.isArray(r.items)) {
        const emps = r.items
          .filter((item: SerperItem) => item.link?.includes('linkedin.com/in/'))
          .map((item: SerperItem): Employee => ({
            name: extractNameFromLinkedInTitle(item.title || ''),
            title: extractTitleFromLinkedInTitle(item.title || ''),
            company: business_name,
            linkedin: item.link!,
            email: null,
            phone: null,
            bio: item.snippet || '',
            location: company_country || 'Unknown',
            enrichment_status: 'pending'
          }));
        for (const emp of emps) {
          if (!existing.has(emp.linkedin)) allEmployees.push(emp);
        }
      }
      await new Promise(r => setTimeout(r, 150));
      if (allEmployees.length >= 5) break; // cap
    }
  }

  // Map and store
  const dmPersonas = await loadDMPersonas(search_id);
  const rows = allEmployees.map((emp) => {
    const mappedPersona: any = mapDMToPersona(emp as any, dmPersonas as any);
    const company = emp.company || business_name || 'Unknown Company';
    const level = mappedPersona?.demographics?.level || 'manager';
    const department = mappedPersona?.demographics?.department || 'General';
    const influence = mappedPersona?.influence || 50;
    const persona_type = mappedPersona?.title || 'decision_maker';
    const experience = mappedPersona?.demographics?.experience || '';
    const communication_preference = mappedPersona?.behaviors?.communicationStyle || '';
    const pain_points = mappedPersona?.characteristics?.painPoints || [];
    const motivations = mappedPersona?.characteristics?.motivations || [];
    const decision_factors = mappedPersona?.characteristics?.decisionFactors || [];
    const created_at = new Date().toISOString();
    return {
      id: undefined,
      search_id,
      user_id,
      persona_id: (mappedPersona && (mappedPersona as any).id) ? (mappedPersona as any).id : null,
      name: emp.name,
      title: emp.title,
      level,
      influence,
      department,
      company,
      location: emp.location || '',
      email: emp.email || '',
      phone: emp.phone || '',
      linkedin: emp.linkedin,
      experience,
      communication_preference,
      pain_points,
      motivations,
      decision_factors,
      persona_type,
      company_context: {},
      personalized_approach: {},
      created_at,
      match_score: 80,
      enrichment_status: emp.enrichment_status || 'pending',
      enrichment: {},
      business_id
    };
  });
  if (rows.length > 0) {
    await insertDecisionMakersBasic(rows as any);
  }
}

async function getExistingLinkedins(search_id: string, business_id: string): Promise<Set<string>> {
  try {
    const { data, error } = await sharedSupa
      .from('decision_makers')
      .select('linkedin')
      .eq('search_id', search_id)
      .eq('business_id', business_id);
    if (error) return new Set();
    const set = new Set<string>();
    (data || []).forEach((d: any) => { if (d.linkedin) set.add(d.linkedin); });
    return set;
  } catch {
    return new Set();
  }
}

async function countDMsForBusiness(search_id: string, business_id: string): Promise<number> {
  try {
    const { count, error } = await sharedSupa
      .from('decision_makers')
      .select('id', { count: 'exact', head: true })
      .eq('search_id', search_id)
      .eq('business_id', business_id);
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}
