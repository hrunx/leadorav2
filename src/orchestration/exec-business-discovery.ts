import { run } from '@openai/agents';

import { BusinessDiscoveryAgent } from '../agents/business-discovery.agent';
import { loadSearch } from '../tools/db.read';
import { countryToGL } from '../tools/util';

export async function execBusinessDiscovery(payload: {
  search_id: string;
  user_id: string;
}) {
  const search = await loadSearch(payload.search_id);
  if (!search) throw new Error(`Search ${payload.search_id} not found`);

  const countries = search.countries.join(', ');
  const industries = search.industries.join(', ');
  // Iterate over all target countries for comprehensive discovery
  const allBusinesses = [];
  
  for (const country of search.countries) {
    const gl = countryToGL(country);
    console.log(`Running business discovery for ${country} (GL: ${gl})`);
    
    try {
      const countryBusinesses = await runBusinessDiscovery({
        id: search.id,
        user_id: search.user_id,
        product_service: search.product_service,
        industries: search.industries || [],
        countries: [country], // Search one country at a time
        search_type: search.search_type
      });
      
      allBusinesses.push(...countryBusinesses);
      console.log(`Found ${countryBusinesses.length} businesses in ${country}`);
    } catch (error: any) {
      console.error(`Business discovery failed for ${country}:`, error.message);
      // Continue with other countries even if one fails
    }
  }
  
  console.log(`Total businesses found across all countries: ${allBusinesses.length}`);
  
  // If we already found businesses from our multi-country search, return them
  if (allBusinesses.length > 0) {
    return allBusinesses;
  }
  
  // Fallback to the original agent-based approach for all countries
  const intent = search.search_type === 'customer' ? 'need' : 'sell provide';
  const q = `${search.product_service} ${intent} ${industries} ${search.countries.join(', ')}`;
  const msg = `search_id=${search.id} user_id=${search.user_id} 
- product_service=${search.product_service}
- industries=${industries}
- countries=${search.countries.join(', ')}
- search_type=${search.search_type}
- discovery_query="${q}"

CRITICAL: Find businesses across ALL specified countries: ${search.countries.join(', ')}
- Iterate through each country: ${search.countries.map(c => `${c} (GL: ${countryToGL(c)})`).join(', ')}
- For each country, use serperPlaces with limit: 10 and precise geographic targeting
- Include ALL specified industries: ${industries}
- Combine results from all countries for comprehensive coverage`;
  
  console.log(`Starting agent-based business discovery for search ${search.id} | Industries: ${industries} | Countries: ${search.countries.join(', ')} | Query: "${q}"`);

  return await run(
    BusinessDiscoveryAgent,
    [{ role: 'user', content: msg }]
  );
}