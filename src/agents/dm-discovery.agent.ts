import { Agent, tool, run } from '@openai/agents';
import { serperSearch } from '../tools/serper';
import { loadBusinesses, loadDMPersonas } from '../tools/db.read';
import { insertDMs, updateSearchProgress, logApiUsage } from '../tools/db.write';
import { countryToGL } from '../tools/util';
import { gemini } from './clients';

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

const linkedInDiscoveryTool = tool({
  name: 'linkedInDiscovery',
  description: 'Advanced LinkedIn search using Gemini AI for better profile extraction and decision maker identification.',
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
    const { 
      company_name, 
      company_city, 
      target_roles, 
      gl, 
      search_id, 
      user_id 
    } = input as { 
      company_name: string;
      company_city?: string;
      target_roles: string[];
      gl: string; 
      search_id: string; 
      user_id: string; 
    };

    const startTime = Date.now();
    try {
      // Build comprehensive LinkedIn search query
      const roleQueries = target_roles.map(role => `"${role}"`).join(' OR ');
      const locationPart = company_city ? ` "${company_city}"` : '';
      
      // Enhanced LinkedIn search pattern
      const query = `site:linkedin.com/in "${company_name}"${locationPart} (${roleQueries}) (Director OR VP OR "Vice President" OR Manager OR Head OR Chief OR Lead)`;
      
      console.log(`LinkedIn search for ${company_name}: ${query}`);
      
      const searchResults = await serperSearch(query, gl, 10);
      
      // Use Gemini to extract and structure LinkedIn profile data
      const prompt = `
Analyze these LinkedIn search results for ${company_name} and extract decision maker profiles.

Search Results:
${searchResults.map((r:any) => `Title: ${r.title}\nSnippet: ${r.snippet}\nURL: ${r.link}`).join('\n\n')}

Your task:
1. Extract real LinkedIn profiles (ignore company pages, ads, or irrelevant results)
2. For each valid profile, extract:
   - Full name (first and last name)
   - Current job title 
   - Company name (must match "${company_name}" or be very similar)
   - LinkedIn profile URL
   - Location if mentioned
   - Department/function (Technology, Sales, Marketing, Operations, Finance, etc.)

Return ONLY a JSON array with this exact structure:
[
  {
    "name": "Full Name",
    "title": "Job Title",
    "company": "Company Name",
    "linkedin": "LinkedIn URL",
    "location": "City, Country",
    "department": "Department"
  }
]

Requirements:
- Only include profiles that are clearly current employees
- Focus on decision-making roles (Directors, VPs, Managers, Heads, Chiefs)
- Ensure names are real person names, not company names
- Maximum 5 profiles per company
- Return empty array if no valid profiles found`;

      // @ts-ignore – gemini SDK typing mismatch
    const geminiResponse = await (gemini as any).generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });

      const responseText = geminiResponse.response.text();
      console.log(`Gemini LinkedIn extraction response: ${responseText.substring(0, 200)}...`);

      // Parse JSON response
      let profiles = [];
      try {
        // Clean up response to extract JSON
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          profiles = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        console.error('Error parsing Gemini response:', parseError);
        console.error('Raw response:', responseText);
      }

      // Log API usage for both Serper and Gemini
      await logApiUsage({
        user_id,
        search_id,
        provider: 'serper',
        endpoint: 'web_search',
        status: 200,
        ms: Date.now() - startTime,
        request: { query, gl, num: 10 },
        response: { count: searchResults.length }
      });

      await logApiUsage({
        user_id,
        search_id,
        provider: 'gemini',
        endpoint: 'generateContent',
        status: 200,
        ms: Date.now() - startTime,
        request: { company: company_name, profiles_found: profiles.length },
        response: { extracted_profiles: profiles.length }
      });

      return { 
        company: company_name,
        profiles: profiles,
        raw_search_count: searchResults.length 
      };

    } catch (error: any) {
      console.error(`LinkedIn discovery error for ${company_name}:`, error);
      
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

// Unused tool for future CSV import functionality, kept for schema reference.

const storeDMsProfilesTool = tool({
  name: 'storeDMsProfiles',
  description: 'Store decision maker profiles from LinkedIn discovery results.',
  parameters: {
    type:'object',
    properties:{ 
      company_profiles: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
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
                  department: { type: 'string' },
                  persona_id: { type: 'string' }
                },
                required: ['name', 'title', 'company', 'linkedin', 'location', 'persona_id'],
                additionalProperties: false
              }
            }
          },
          required: ['company', 'profiles'],
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
        company: string;
        profiles: Array<{
          name: string;
          title: string;
          company: string;
          linkedin?: string;
          location?: string;
          department?: string;
          persona_id: string;
        }>;
      }>;
      search_id: string;
      user_id: string;
    };
    
    console.log(`Storing DM profiles for search ${search_id}: ${company_profiles.length} companies`);
    
    const allProfiles = company_profiles.flatMap(cp => cp.profiles);
    console.log(`Total profiles to store: ${allProfiles.length}`);
    
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
            persona_id: profile.persona_id,
            name: profile.name,
            title: profile.title,
            level: inferLevel(profile.title),
            department: profile.department || inferDepartment(profile.title),
            influence: inferInfluence(profile.title),
            company: profile.company,
          location: profile.location || '',
          match_score: 85,
          email: email,
          phone: '', // Will be generated if needed
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
            department: profile.department || ''
          }
        };
      })
      .filter(dm => dm.name && dm.title); // Only include with valid name and title
    
    console.log(`Inserting ${rows.length} decision makers for search ${search_id}`);
    return await insertDMs(rows);
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
Goal: Discover real decision makers via LinkedIn and map them PRECISELY to the specific DM personas generated earlier.

PRECISION MAPPING PROCESS:
1) Call readCompanies to get business names/locations with complete details
2) Call readDMPersonas to get exact persona definitions including:
   - Specific titles and role patterns
   - Target departments and responsibilities  
   - Decision authority levels
   - Geographic and industry preferences
3) For each company, execute PERSONA-TARGETED LinkedIn discovery:
   - Extract target roles directly from each persona's title and department
   - Call linkedInDiscovery with company + persona-specific role queries
   - Use Gemini AI to analyze profiles and match to specific personas
   - Focus on roles that match persona decision authority and responsibilities
4) INTELLIGENT PERSONA MAPPING:
   - Analyze each discovered profile against all personas
   - Map based on title similarity, department match, and responsibility overlap
   - Consider decision authority level (C-Level, VP, Director, Manager)
   - Account for industry-specific variations in titles
5) Store decision makers with PRECISE persona assignments:
   - Call storeDMsProfiles providing persona_id for each profile
   - Each DM linked to their best-matching persona_id
   - Complete profile information from LinkedIn
   - Detailed reasoning for persona assignment
   - Enhanced contact information and targeting data

PRECISION TARGETING BY SEARCH CONTEXT:
- Customer searches: Find decision makers who would EVALUATE/BUY the product/service
- Supplier searches: Find decision makers who would PROCURE/SOURCE similar offerings
- Match personas based on decision authority for the specific product/service
- Consider local business hierarchies and title variations

ENHANCED QUALITY STANDARDS:
- 100% real LinkedIn profiles with current positions
- Direct mapping to specific persona types
- Focus on decision makers with authority for the search context
- Complete contact information extraction
- Geographic and industry context verification
- 3-7 decision makers per company for comprehensive persona coverage

CRITICAL SUCCESS METRICS:
- Each persona must have mapped decision makers
- Each decision maker must have a justified persona assignment
- All contact information must be complete and actionable
- Geographic targeting must be precise to search criteria
- Generate professional email addresses based on name patterns`,
  tools: [readCompaniesTool, readDMPersonasTool, linkedInDiscoveryTool, storeDMsProfilesTool],
  handoffDescription: 'Discovers real decision makers via advanced LinkedIn search with Gemini AI for profile extraction',
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
    await updateSearchProgress(search.id, 70, 'dm_discovery', 'in_progress');
    
    const countries = search.countries.join(', ');
    const industries = search.industries.join(', ');
    const gl = countryToGL(search.countries[0]); // Use first country for GL code
    const msg = `search_id=${search.id} user_id=${search.user_id} 
- product_service=${search.product_service}
- industries=${industries}
- countries=${countries}
- search_type=${search.search_type}
- gl=${gl}

  CRITICAL: Find decision makers for companies across ALL specified countries (${countries}) and ALL specified industries (${industries}) who would be decision makers for "${search.product_service}". Use LinkedIn search targeting senior roles like Directors, VPs, Heads, and Managers in roles relevant to the product/service. Map each decision maker to the appropriate persona_id and include persona_id when storing profiles.`;
    
    console.log(`Starting decision maker discovery for search ${search.id} | Industries: ${industries} | Countries: ${countries} | Product: ${search.product_service}`);
    
    await run(DMDiscoveryAgent, [{ role: 'user', content: msg }]);
    
    await updateSearchProgress(search.id, 85, 'dm_discovery_completed');
    console.log(`Completed decision maker discovery for search ${search.id}`);
  } catch (error) {
    console.error(`Decision maker discovery failed for search ${search.id}:`, error);
    throw error;
  }
}