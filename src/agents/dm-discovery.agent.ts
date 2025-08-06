import { Agent, tool, run } from '@openai/agents';
import { serperSearch } from '../tools/serper';
import { loadBusinesses, loadDMPersonas } from '../tools/db.read';
import { insertDecisionMakersBasic, updateSearchProgress, logApiUsage } from '../tools/db.write';
import { countryToGL } from '../tools/util';

const readCompaniesTool = tool({
  name: 'readCompanies',
  description: 'Load companies for search.',
  parameters: { 
    type:'object', 
    properties:{ search_id:{type:'string'} }, 
    required:['search_id'],
    additionalProperties: false
  } as const,
  execute: async (input: unknown) => {
    const { search_id } = input as { search_id: string };
    return await loadBusinesses(search_id);
  }
});

const readDMPersonasTool = tool({
  name: 'readDMPersonas',
  description: 'Load DM personas for mapping.',
  parameters: { 
    type:'object', 
    properties:{ search_id:{type:'string'} }, 
    required:['search_id'],
    additionalProperties: false
  } as const,
  execute: async (input: unknown) => {
    const { search_id } = input as { search_id: string };
    return await loadDMPersonas(search_id);
  }
});

const linkedinSearchTool = tool({
  name: 'linkedinSearch',
  description: 'Search LinkedIn for decision makers using multiple strategic approaches.',
  parameters: {
    type:'object',
    properties:{ 
      company_name: {type:'string'},
      company_city: {type:'string'},
      company_country: {type:'string'},
      target_roles: {type:'array', items: {type:'string'}},
      gl: {type:'string'}, 
      search_id: { type: 'string' },
      user_id: { type: 'string' }
    },
    required: ['company_name', 'company_city', 'company_country', 'target_roles', 'gl', 'search_id', 'user_id'],
    additionalProperties: false
  } as const,
  execute: async (input: unknown) => {
    const { company_name, company_city, target_roles, gl, search_id, user_id } = input as {
      company_name: string;
      company_city?: string;
      company_country?: string;
      target_roles: string[];
      gl: string;
      search_id: string;
      user_id: string;
    };

    const startTime = Date.now();
    const allProfiles: any[] = [];

    try {
      // Strategy 1: Company + Target Roles + Seniority
      const rolesQuery = target_roles.slice(0, 3).map(role => `"${role}"`).join(' OR ');
      const seniorityTerms = '(Director OR VP OR "Vice President" OR Manager OR Head OR Chief OR Lead)';
      const query1 = `site:linkedin.com/in "${company_name}" (${rolesQuery}) ${seniorityTerms}`;

      console.log(`LinkedIn search for ${company_name}: ${query1}`);
      const searchResults1 = await serperSearch(query1, gl, 10);

      // Strategy 2: Company + Generic decision maker roles
      const genericRoles = '"CEO" OR "CTO" OR "CMO" OR "COO" OR "CFO" OR "VP" OR "Director"';
      const query2 = `site:linkedin.com/in "${company_name}" (${genericRoles})`;
      
      const searchResults2 = await serperSearch(query2, gl, 10);

      // Strategy 3: Location-based search if available
      let searchResults3: any[] = [];
      if (company_city) {
        const query3 = `site:linkedin.com/in "${company_city}" "${company_name}" (${rolesQuery})`;
        searchResults3 = await serperSearch(query3, gl, 10);
      }

      // Combine and deduplicate results
      const allResults = [...searchResults1, ...searchResults2, ...searchResults3];
      const uniqueResults = allResults.filter((result, index, self) => 
        index === self.findIndex(r => r.link === result.link)
      );

      // Extract basic profile information from search results
      for (const result of uniqueResults.slice(0, 15)) { // Limit to 15 profiles max
        if (result.title && result.link?.includes('linkedin.com/in/')) {
          const profile = extractBasicProfile(result, company_name);
          if (profile) {
            allProfiles.push(profile);
          }
        }
      }

      // Log API usage
      await logApiUsage({
        user_id,
        search_id,
        provider: 'serper',
        endpoint: 'web_search',
        status: 200,
        ms: Date.now() - startTime,
        request: { company: company_name, strategies: 3 },
        response: { profiles_found: allProfiles.length, total_results: uniqueResults.length }
      });

      return { 
        company: company_name,
        profiles: allProfiles,
        raw_search_count: uniqueResults.length 
      };

    } catch (error: any) {
      console.error(`LinkedIn search error for ${company_name}:`, error);
      
      await logApiUsage({
        user_id,
        search_id,
        provider: 'serper',
        endpoint: 'web_search',
        status: 500,
        ms: Date.now() - startTime,
        request: { company: company_name },
        response: { error: error.message }
      });

      return { 
        company: company_name,
        profiles: [],
        error: error.message 
      };
    }
  }
});

// Extract basic profile information from Serper search results
function extractBasicProfile(result: any, companyName: string) {
  const title = result.title || '';
  const snippet = result.snippet || '';
  const link = result.link || '';

  // Extract name from title (usually "Name - Title at Company" format)
  const namePart = title.split(' - ')[0] || title.split(' | ')[0] || title.split(',')[0];
  const name = namePart.trim();

  // Extract title/position
  let position = '';
  if (title.includes(' - ')) {
    position = title.split(' - ')[1] || '';
  } else if (snippet.includes('at ')) {
    const atIndex = snippet.indexOf('at ');
    position = snippet.substring(0, atIndex).trim();
  }

  // Clean up position
  position = position.replace(/\bat\s+.*$/i, '').trim();
  
  if (!name || !position || name.length < 2) {
    return null;
  }

  return {
    name,
    title: position,
    company: companyName,
    linkedin: link,
    location: '', // Will be enriched later
    department: inferDepartment(position)
  };
}

const storeDecisionMakersBasicTool = tool({
  name: 'storeDecisionMakersBasic',
  description: 'Store basic decision maker profiles immediately for fast display.',
  parameters: {
    type:'object',
    properties:{ 
      company_profiles: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            business_id: { type: 'string' },
            company: { type: 'string' },
            profiles: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  title: { type: 'string' },
                  company: { type: 'string' },
                  linkedin: { type: 'string' },
                  location: { type: 'string' },
                  department: { type: 'string' }
                },
                required: ['name', 'title', 'company', 'linkedin', 'location', 'department'],
                additionalProperties: false
              }
            }
          },
          required: ['business_id', 'company', 'profiles'],
          additionalProperties: false
        }
      },
      search_id: { type: 'string' },
      user_id: { type: 'string' }
    },
    required: ['company_profiles', 'search_id', 'user_id'],
    additionalProperties: false
  } as const,
  execute: async (input: unknown) => {
    const { company_profiles, search_id, user_id } = input as { 
      company_profiles: Array<{
        business_id: string;
        company: string;
        profiles: Array<{
          name: string;
          title: string;
          company: string;
          linkedin?: string;
          location?: string;
          department?: string;
        }>;
      }>;
      search_id: string;
      user_id: string;
    };
    
    console.log(`Storing basic DM profiles for search ${search_id}: ${company_profiles.length} companies`);
    
    const allProfiles = company_profiles.flatMap(cp => 
      cp.profiles.map(profile => ({ ...profile, business_id: cp.business_id }))
    );
    console.log(`Total basic profiles to store: ${allProfiles.length}`);
    
    const rows = allProfiles
      .slice(0, 50) // Cap at 50 total DMs
      .map(profile => {
        // Generate email from name and company
        const nameParts = profile.name.toLowerCase().split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts[nameParts.length - 1];
        const companyDomain = profile.company.toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .replace(/(inc|corp|llc|ltd|company|co)$/, '') + '.com';
        const email = `${firstName}.${lastName}@${companyDomain}`;
        
        return {
          search_id,
          user_id,
          business_id: profile.business_id, // Link to the business record
          persona_id: null, // Will be mapped later
          name: profile.name,
          title: profile.title,
          level: inferLevel(profile.title),
          department: profile.department || inferDepartment(profile.title),
          influence: inferInfluence(profile.title),
          company: profile.company,
          location: profile.location || '',
          match_score: 75, // Basic score, will be enhanced later
          email: email,
          phone: '',
          linkedin: profile.linkedin || '',
          experience: '',
          communication_preference: '',
          pain_points: [],
          motivations: [],
          decision_factors: [],
          persona_type: 'decision_maker',
          company_context: {},
          personalized_approach: {
            location: profile.location || '',
            department: profile.department || inferDepartment(profile.title)
          }
        };
      })
      .filter(dm => dm.name && dm.title); // Only include with valid name and title
    
    console.log(`Inserting ${rows.length} basic decision makers for search ${search_id}`);
    return await insertDecisionMakersBasic(rows);
  }
});

// Helper functions for inferring DM attributes
function inferLevel(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('ceo') || t.includes('president') || t.includes('founder')) return 'executive';
  if (t.includes('cto') || t.includes('cfo') || t.includes('cmo')) return 'executive';
  if (t.includes('vp') || t.includes('vice president')) return 'executive';
  if (t.includes('director') || t.includes('head of')) return 'director';
  if (t.includes('manager') || t.includes('lead')) return 'manager';
  return 'individual';
}

function inferInfluence(title: string): number {
  const level = inferLevel(title);
  switch (level) {
    case 'executive': return 95;
    case 'director': return 80;
    case 'manager': return 65;
    default: return 45;
  }
}

function inferDepartment(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('tech') || t.includes('engineer') || t.includes('dev')) return 'Technology';
  if (t.includes('market') || t.includes('sales')) return 'Sales & Marketing';
  if (t.includes('finance') || t.includes('accounting')) return 'Finance';
  if (t.includes('operation') || t.includes('ops')) return 'Operations';
  if (t.includes('hr') || t.includes('people')) return 'Human Resources';
  return 'General Management';
}

export const DMDiscoveryAgent = new Agent({
  name: 'DMDiscoveryAgent',
  instructions: `
Goal: Quickly discover and store basic decision maker profiles for immediate UI display. Enrichment happens later.

FAST-FIRST PROCESS:
1) Call readCompanies to get business names, locations, and IDs
2) Call readDMPersonas to understand target roles and departments
3) For each business, execute fast LinkedIn discovery:
   - Use linkedinSearch with business name, city, and country
   - Extract basic information: name, title, company, LinkedIn URL
   - Focus on decision-making roles (Directors, VPs, Managers, etc.)
   - NO AI analysis - just extract basic data from search results
4) Store ALL basic profiles immediately using storeDecisionMakersBasic:
   - CRITICAL: Include business_id to link decision makers to specific businesses
   - Basic contact info and inferred departments
   - Set enrichment_status = 'pending' for background processing
   - Generate professional email addresses
   - Focus on speed over completeness

SEARCH STRATEGIES:
- Company name + target roles + seniority keywords
- Company name + generic C-level/VP/Director terms  
- Location-based search when city is available
- Multiple searches per company to maximize coverage

QUALITY STANDARDS:
- Real LinkedIn profiles only
- Valid name and title required
- 3-10 decision makers per company
- Focus on roles with decision authority
- Complete basic contact information

SUCCESS METRICS:
- Fast storage of basic profiles (under 30 seconds total)
- Immediate UI display capability
- High coverage of decision-making roles
- Valid LinkedIn URLs for all profiles
- Professional email generation

This agent prioritizes SPEED and IMMEDIATE DISPLAY. Detailed enrichment (pain points, motivations, detailed analysis) happens in background processing.`,
  tools: [readCompaniesTool, readDMPersonasTool, linkedinSearchTool, storeDecisionMakersBasicTool],
  handoffDescription: 'Fast discovery and storage of basic decision maker profiles for immediate display',
  handoffs: [],
  model: 'gpt-4o-mini'
});

export async function runDMDiscovery(search: {
  id:string; 
  user_id:string; 
  product_service:string; 
  industries:string[]; 
  countries:string[];
  search_type?: string;
}) {
  try {
    await updateSearchProgress(search.id, 70, 'decision_makers', 'in_progress');
    
    const countries = search.countries.join(', ');
    const industries = search.industries.join(', ');
    const gl = countryToGL(search.countries[0]); // Use first country for GL code
    const msg = `search_id=${search.id} user_id=${search.user_id} 
- product_service=${search.product_service}
- industries=${industries}
- countries=${countries}
- search_type=${search.search_type}
- gl=${gl}

CRITICAL: Find decision makers for companies across ALL specified countries (${countries}) and ALL specified industries (${industries}) who would be decision makers for "${search.product_service}". 

Use fast LinkedIn search targeting senior roles like Directors, VPs, Heads, and Managers. Store basic profiles immediately for UI display. Focus on SPEED over detailed analysis.`;
    
    console.log(`Starting fast decision maker discovery for search ${search.id} | Industries: ${industries} | Countries: ${countries} | Product: ${search.product_service}`);
    
    await run(DMDiscoveryAgent, [{ role: 'user', content: msg }]);
    
    await updateSearchProgress(search.id, 80, 'decision_makers', 'completed');
    console.log(`Completed fast decision maker discovery for search ${search.id}`);
  } catch (error) {
    console.error(`Decision maker discovery failed for search ${search.id}:`, error);
    throw error;
  }
}