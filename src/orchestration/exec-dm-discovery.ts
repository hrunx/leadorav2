import { run } from '@openai/agents';

import { DMDiscoveryAgent } from '../agents/dm-discovery.agent';
import { loadSearch } from '../tools/db.read';
import { countryToGL } from '../tools/util';

export async function execDMDiscovery(payload: {
  search_id: string;
  user_id: string;
}) {
  const search = await loadSearch(payload.search_id);
  if (!search) throw new Error(`Search ${payload.search_id} not found`);

  const country = search.countries[0]; 
  const gl = countryToGL(country);
  const msg = `search_id=${search.id} user_id=${search.user_id} gl=${gl} industry=${search.industries[0]} country=${country}
    
Find decision makers for each company using LinkedIn search. Focus on senior roles like Directors, VPs, Heads, and Managers.`;

  return await run(
    DMDiscoveryAgent,
    [{ role: 'user', content: msg }],

  );
}