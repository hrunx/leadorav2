import { run } from '@openai/agents';

import { DMPersonaAgent } from '../agents/dm-persona.agent';
import { loadSearch } from '../tools/db.read';

export async function execDMPersonas(payload: {
  search_id: string;
  user_id: string;
}) {
  const search = await loadSearch(payload.search_id);
  if (!search) throw new Error(`Search ${payload.search_id} not found`);

  const msg = `search_id=${search.id} user_id=${search.user_id}
- product_service=${search.product_service}
- industries=${search.industries.join(',')}
- countries=${search.countries.join(',')}
- lens=${search.search_type==='customer'?'buyers/implementers':'category owners / category managers / sales leaders'}`;

  return await run(
    DMPersonaAgent,
    [{ role: 'user', content: msg }],

  );
}