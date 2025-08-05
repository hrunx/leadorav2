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

  const country = search.countries[0]; 
  const gl = countryToGL(country);
  const intent = search.search_type === 'customer' ? 'buyers' : 'suppliers';
  const q = `${search.product_service} ${intent} ${search.industries[0]} ${country}`;
  const msg = `search_id=${search.id} user_id=${search.user_id} industry=${search.industries[0]} country=${country} q="${q}" gl=${gl}`;

  return await run(
    BusinessDiscoveryAgent,
    [{ role: 'user', content: msg }],

  );
}