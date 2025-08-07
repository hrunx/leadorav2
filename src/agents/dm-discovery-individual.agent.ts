import { Agent, tool } from '@openai/agents';
import { serperSearch } from '../tools/serper';
import { insertDecisionMakersBasic, logApiUsage } from '../tools/db.write';
import { loadDMPersonas } from '../tools/db.read';
import { mapDMToPersona } from '../tools/util';
import { mapDecisionMakersToPersonas } from '../tools/persona-mapper';

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
    required: ['company_name', 'company_country', 'search_id', 'user_id'],
    additionalProperties: false
  } as const,
  execute: async (input: unknown) => {
    const { company_name, company_country, search_id, user_id, product_service } = input as { 
      company_name: string; 
      company_country: string;
      search_id: string; 
      user_id: string;
      product_service?: string;
    };
    
    const startTime = Date.now();
    
    try {
      // Create LinkedIn-specific search queries for this company with product/service context
      const baseQueries = [
        `"${company_name}" site:linkedin.com/in/ CEO OR "Chief Executive"`,
        `"${company_name}" site:linkedin.com/in/ CTO OR "Chief Technology"`,
        `"${company_name}" site:linkedin.com/in/ CMO OR "Chief Marketing"`,
        `"${company_name}" site:linkedin.com/in/ CFO OR "Chief Financial"`,
        `"${company_name}" site:linkedin.com/in/ VP OR "Vice President"`,
        `"${company_name}" site:linkedin.com/in/ Director OR Manager`
      ];

      // Add product/service-specific queries for better targeting
      const contextualQueries = [];
      if (product_service) {
        const productKeywords = product_service.toLowerCase();
        // Add queries targeting relevant departments for this product/service
        if (productKeywords.includes('software') || productKeywords.includes('tech') || productKeywords.includes('saas') || productKeywords.includes('app')) {
          contextualQueries.push(`"${company_name}" site:linkedin.com/in/ "IT Director" OR "Technology Manager" OR "Software Lead"`);
        }
        if (productKeywords.includes('marketing') || productKeywords.includes('advertising') || productKeywords.includes('campaign')) {
          contextualQueries.push(`"${company_name}" site:linkedin.com/in/ "Marketing Director" OR "Brand Manager" OR "Digital Marketing"`);
        }
        if (productKeywords.includes('sales') || productKeywords.includes('crm') || productKeywords.includes('lead')) {
          contextualQueries.push(`"${company_name}" site:linkedin.com/in/ "Sales Director" OR "Sales Manager" OR "Revenue"`);
        }
        if (productKeywords.includes('hr') || productKeywords.includes('human') || productKeywords.includes('employee') || productKeywords.includes('talent')) {
          contextualQueries.push(`"${company_name}" site:linkedin.com/in/ "HR Director" OR "People Manager" OR "Human Resources"`);
        }
        if (productKeywords.includes('finance') || productKeywords.includes('accounting') || productKeywords.includes('invoice')) {
          contextualQueries.push(`"${company_name}" site:linkedin.com/in/ "Finance Manager" OR "Controller" OR "Accounting"`);
        }
      }

      const queries = [...baseQueries, ...contextualQueries];
      
      const allEmployees: Employee[] = [];
      
      // Search for employees in different roles
      for (const query of queries) {
        try {
          const result = await serperSearch(query, company_country, 5) as { success: boolean; items?: SerperItem[] };
          if (result.success && result.items) {
            const employees = result.items
              .filter((item: SerperItem) =>
                item.link?.includes('linkedin.com/in/') &&
                item.title?.toLowerCase().includes(company_name.toLowerCase())
              )
              .map((item: SerperItem): Employee => ({
                name: extractNameFromLinkedInTitle(item.title),
                title: extractTitleFromLinkedInTitle(item.title),
                company: company_name,
                linkedin: item.link,
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
          
          // Small delay between searches to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (searchError) {
          console.warn(`LinkedIn search failed for query: ${query}`, searchError);
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
        console.warn('Failed to log LinkedIn search usage:', logError);
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
          response: { error: error.message }
        });
      } catch (logError) {
        console.warn('Failed to log LinkedIn search error:', logError);
      }
      
      throw error;
    }
  }
});

// --- Helper: Validate Decision Maker completeness ---
function isValidDecisionMaker(dm: any): boolean {
  const isNonEmptyString = (v: any) => typeof v === 'string' && v.trim() && !['unknown', 'n/a', 'default', 'none'].includes(v.trim().toLowerCase());
  const isNonEmptyArray = (v: any) => Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString);
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
    if (!dm.persona_id) return false;
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
      const mappedPersona = mapDMToPersona(emp, dmPersonas);
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

    console.log(`💼 Storing ${validRows.length} decision makers with smart persona mapping for business ${business_id}`);
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
          .catch(err => console.error('Deferred DM persona mapping failed:', err));
      }, 10000);
    }

    try {
      // Trigger backend enrichment via Netlify function without blocking
      void fetch(enrichUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search_id })
      }).catch(err => {
        console.error('Failed to trigger enrichment:', err);
      });
    } catch (err) {
      console.error('Failed to trigger enrichment:', err);
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
  // Ensure DM personas are available before running discovery
  await waitForPersonas(params.search_id);

  const message = `Find LinkedIn employees for this company immediately:

Company: ${params.business_name}
Country: ${params.company_country}
Industry: ${params.industry}
Product/Service Context: ${params.product_service || 'Not specified'}
Business ID: ${params.business_id}
Search ID: ${params.search_id}
User ID: ${params.user_id}

Search LinkedIn for executives and decision makers who would be involved in purchasing/using "${params.product_service || 'business solutions'}". Focus on relevant departments and roles that would influence buying decisions for this type of product/service. Store them with smart persona mapping.`;

  const result = await run(DMDiscoveryIndividualAgent, message);
  return result;
}

// Polls until DM personas exist or a timeout is reached
async function waitForPersonas(search_id: string, timeoutMs = 300000, delayMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const personas = await loadDMPersonas(search_id);
    if (personas && personas.length > 0) return personas;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  console.warn(`DM personas not ready for search ${search_id} after ${Math.round(timeoutMs / 1000)}s.`);
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
