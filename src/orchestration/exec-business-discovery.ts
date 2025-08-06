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
  const gl = countryToGL(search.countries[0]); // Use first country for GL code
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

  return await run(
    BusinessDiscoveryAgent,
    [{ role: 'user', content: msg }]
  );
}