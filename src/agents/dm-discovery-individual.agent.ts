import { Agent, tool } from '@openai/agents';
import { serperSearch } from '../tools/serper';
import { resolveModel, supa as sharedSupa } from './clients';
import { insertDecisionMakersBasic, logApiUsage } from '../tools/db.write';
import { loadDMPersonas } from '../tools/db.read';
import { mapDMToPersona } from '../tools/util';
import logger from '../lib/logger';
import { mapDecisionMakersToPersonas } from '../tools/persona-mapper';
import { enrichDecisionMakersFromSingleLinkedInSearch } from '../tools/dm-company-search';

// Use shared query cache utilities for deduplication
import { hasSeenQuery as hasSeen, markSeenQuery as markSeen } from '../tools/query-cache';


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

// helper to filter out existing LinkedIns for the search
async function filterExistingByLinkedin(search_id: string, employees: Employee[]): Promise<Employee[]> {
  try {
    const links = employees.map(e => e.linkedin).filter(Boolean);
    if (links.length === 0) return employees;
    const { data } = await sharedSupa
      .from('decision_makers')
      .select('linkedin')
      .eq('search_id', search_id)
      .in('linkedin', links);
    const existing = new Set<string>((data || []).map((d: any) => d.linkedin));
    return employees.filter(e => !existing.has(e.linkedin));
  } catch {
    return employees;
  }
}

type SerperItem = { link?: string; title?: string; snippet?: string };

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
      // Build a single precise query per company to minimize API calls
      const ctx = (product_service || '').trim();
      const singleQuery = `"${company_name}" site:linkedin.com/in/${ctx ? ` ${ctx}` : ''}`.trim();
      logger.info('[DM] LinkedIn singleQuery', { company_name, company_country, q: singleQuery, search_id });

      let allEmployees: Employee[] = [];

      // Cleanup old cached queries (non-blocking)
      const cacheExpiryIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      void (async () => {
        try {
          await sharedSupa
            .from('linkedin_query_cache')
            .delete()
            .lt('created_at', cacheExpiryIso);
        } catch {
          // ignore cache cleanup errors
        }
      })();

      // Execute exactly one web search per company
      try {
        if (!(await hasSeen(company_name, singleQuery))) {
          const { data: cached } = await sharedSupa
            .from('linkedin_query_cache')
            .select('search_id')
            .eq('search_id', search_id)
            .eq('company', company_name)
            .eq('query', singleQuery)
            .gte('created_at', cacheExpiryIso)
            .maybeSingle();
          if (!cached) {
            const result = await serperSearch(singleQuery, company_country, 10);
            logger.info('[DM] LinkedIn search results', { count: Array.isArray(result?.items) ? result.items.length : 0, company_name, search_id });
            if (result && result.success && Array.isArray(result.items)) {
              const employees = result.items
                .filter((item: SerperItem) =>
                  item.link?.includes('linkedin.com/in/') &&
                  (
                    item.title?.toLowerCase().includes(company_name.toLowerCase()) ||
                    item.snippet?.toLowerCase().includes(company_name.toLowerCase())
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

              // Store employees immediately with enrichment_status: 'pending'
              allEmployees.push(...employees.slice(0, 10));
            }

            // Mark this query as seen and cache
            await markSeen(company_name, singleQuery);
            try {
              await sharedSupa.from('linkedin_query_cache').insert({
                search_id,
                company: company_name,
                query: singleQuery
              });
            } catch {}
          }
        }
      } catch (searchError) {
        logger.warn('LinkedIn search failed', { query: singleQuery, error: (searchError as any)?.message || searchError });
      }
      
      const endTime = Date.now();
      // Filter out DMs that already exist in this search by linkedin URL
      allEmployees = await filterExistingByLinkedin(search_id, allEmployees);
      
      // Log API usage
      try {
        await logApiUsage({
          user_id,
          search_id,
          provider: 'serper',
          endpoint: 'linkedin_search',
          status: 200,
          ms: endTime - startTime,
          request: { company_name, company_country, queries: 1 },
          response: { employees_found: allEmployees.length }
        });
      } catch (logError) {
        logger.warn('Failed to log LinkedIn search usage', { error: (logError as any)?.message || logError });
      }
      
      // Remove duplicates based on LinkedIn URL
      const uniqueEmployees = allEmployees.filter((employee, index, self) => 
        index === self.findIndex(e => e.linkedin === employee.linkedin)
      );
      // Final cap: env-configurable (defaults to 5)
      const cap = Number(process.env.LINKEDIN_MAX_EMPLOYEES_PER_COMPANY || 5);
      return { employees: uniqueEmployees.slice(0, Math.max(1, cap)) };
      
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
      // Infer missing fields from title when mapping is incomplete
      const deriveLevel = (title: string): 'executive'|'director'|'manager'|'individual' => {
        const t = (title || '').toLowerCase();
        if (/(chief|cfo|ceo|cto|coo|cmo|cio|evp|svp)/.test(t)) return 'executive';
        if (/(vp|vice|director|head)/.test(t)) return 'director';
        if (/(manager|lead)/.test(t)) return 'manager';
        return 'individual';
      };
      const deriveDepartment = (title: string): string => {
        const t = (title || '').toLowerCase();
        if (/sales|account|revenue|bd|business development/.test(t)) return 'Sales';
        if (/marketing|brand|growth/.test(t)) return 'Marketing';
        if (/procure|purchase|sourcing|supply/.test(t)) return 'Procurement';
        if (/engineer|engineering|technology|it|product|data|software|technical/.test(t)) return 'Technology';
        if (/operations|ops|plant|manufactur|logistics/.test(t)) return 'Operations';
        if (/finance|accounting|cfo/.test(t)) return 'Finance';
        if (/hr|people|talent/.test(t)) return 'HR';
        return 'General';
      };
      const deriveInfluence = (level: string): number => {
        switch ((level || '').toLowerCase()) {
          case 'executive': return 95;
          case 'director': return 80;
          case 'manager': return 65;
          default: return 50;
        }
      };
      const levelRaw = String(mappedPersona?.demographics?.level || deriveLevel(emp.title) || 'manager').toLowerCase();
      const normalizedLevel = ((): 'executive'|'director'|'manager'|'individual' => {
        if (/(chief|cfo|ceo|cto|coo|cmo|cio|evp|svp|president|founder)/.test(levelRaw)) return 'executive';
        if (/(vp\b|vice|director|head)/.test(levelRaw)) return 'director';
        if (/(manager|lead|supervisor)/.test(levelRaw)) return 'manager';
        return 'individual';
      })();
      const department = mappedPersona?.demographics?.department || deriveDepartment(emp.title);
      const influence = typeof mappedPersona?.influence === 'number' ? mappedPersona.influence : deriveInfluence(normalizedLevel);
      const persona_type = mappedPersona?.title || 'decision_maker';
      const match_score = typeof mappedPersona?.match_score === 'number'
        ? mappedPersona.match_score
        : Math.min(95, Math.max(60, (
            (persona_type && emp.title && persona_type.toLowerCase().split(/\W+/).some((w: string) => emp.title.toLowerCase().includes(w)) ? 15 : 0) +
            (department !== 'General' ? 10 : 0) +
            Math.round(influence/3)
          )));
      const experience = mappedPersona?.demographics?.experience || '';
      const communication_preference = mappedPersona?.behaviors?.communicationStyle || '';
      const pain_points = Array.isArray(mappedPersona?.characteristics?.painPoints) ? mappedPersona.characteristics.painPoints : [];
      const motivations = Array.isArray(mappedPersona?.characteristics?.motivations) ? mappedPersona.characteristics.motivations : [];
      const decision_factors = Array.isArray(mappedPersona?.characteristics?.decisionFactors) ? mappedPersona.characteristics.decisionFactors : [];
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
        level: normalizedLevel,
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
    // Enrichment endpoint computed on-demand when needed by UI button
    // Schedule follow-up persona assignment for any unmapped DMs
    if (rows.some(r => !r.persona_id)) {
      setTimeout(() => {
        waitForPersonas(search_id)
          .then(() => mapDecisionMakersToPersonas(search_id))
          .catch(err => logger.warn('Deferred DM persona mapping failed', { error: (err as any)?.message || err }));
      }, 10000);
    }

    // Make enrichment manual-only: do not auto-trigger here. UI provides a button.
    logger.debug('Skipping auto enrichment trigger (manual-only mode)', { search_id });

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
2. Search LinkedIn for employees using a single, precise web search query
3. Store decision makers with SMART PERSONA MAPPING

LINKEDIN SEARCH STRATEGY:
- Use site:linkedin.com/in/ with the company name (and product context if provided)
- Extract names, titles, and LinkedIn URLs

SMART PERSONA MAPPING:
- Match each employee to the most relevant DM persona based on:
  - Job title keywords (CEO→C-Level, Manager→Middle Management)
  - Department alignment (CTO→Technical, CMO→Marketing)
  - Seniority level (VP→Senior, Director→Mid-Level)

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
  // Deterministic-only: perform exactly ONE Serper search per business using up to 3 persona titles
  await runDeterministicDMDiscovery(params);
  return { success: true, fallback: false } as any;
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
  const { search_id, user_id, business_id, business_name, company_country } = params;
  // Get top 3 DM persona titles (if available)
  const personas = await loadDMPersonas(search_id);
  const titles = Array.isArray(personas)
    ? personas.slice(0, 3).map((p: any) => String(p.title || '').trim()).filter(Boolean)
    : [];
  const count = await enrichDecisionMakersFromSingleLinkedInSearch({
    search_id,
    user_id,
    business_id,
    company: business_name,
    country: company_country,
    personaTitles: titles
  });
  logger.info('[DM-ONE-SEARCH] stored DMs', { company: business_name, count });
}

// Removed usage; keep helper commented for potential future diagnostics
// async function countDMsForBusiness(search_id: string, business_id: string): Promise<number> {
//   try {
//     const { count, error } = await sharedSupa
//       .from('decision_makers')
//       .select('id', { count: 'exact', head: true })
//       .eq('search_id', search_id)
//       .eq('business_id', business_id);
//     if (error) return 0;
//     return count || 0;
//   } catch {
//     return 0;
//   }
// }
