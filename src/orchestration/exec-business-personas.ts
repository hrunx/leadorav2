import { run } from '@openai/agents';

import { BusinessPersonaAgent } from '../agents/business-persona.agent';
import { loadSearch } from '../tools/db.read';

export async function execBusinessPersonas(payload: {
  search_id: string;
  user_id: string;
}) {
  const search = await loadSearch(payload.search_id);
  if (!search) throw new Error(`Search ${payload.search_id} not found`);

  const msg = `search_id=${search.id} user_id=${search.user_id}
- product_service=${search.product_service}
- industries=${search.industries.join(',')}
- countries=${search.countries.join(',')}
- lens=${search.search_type==='customer'?'companies that need':'companies that sell/provide'}`;

  return await run(
    BusinessPersonaAgent,
    [{ role: 'user', content: msg }]
  );
}