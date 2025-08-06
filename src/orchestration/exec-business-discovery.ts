import { run } from '@openai/agents';

import { BusinessDiscoveryAgent, runBusinessDiscovery } from '../agents/business-discovery.agent';
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
  // The business discovery agent stores businesses directly in the database
  // We don't need to iterate countries here - let the agent handle all countries
  
  // Use the standard business discovery agent which stores businesses directly
  return await runBusinessDiscovery({
    id: search.id,
    user_id: search.user_id,
    product_service: search.product_service,
    industries: search.industries || [],
    countries: search.countries, // Pass all countries to the agent
    search_type: search.search_type
  });
}