import { runBusinessDiscovery } from '../agents/business-discovery.agent';
import { loadSearch } from '../tools/db.read';

export async function execBusinessDiscovery(payload: {
  search_id: string;
  user_id: string;
}) {
  const search = await loadSearch(payload.search_id);
  if (!search) throw new Error(`Search ${payload.search_id} not found`);

  // const countries = search.countries.join(', ');
  // const industries = search.industries.join(', ');
  // The business discovery agent stores businesses directly in the database
  // We don't need to iterate countries here - let the agent handle all countries
  
  // Use the standard business discovery agent which stores businesses directly
  const agentSearch = {
    id: String((search as any)?.id || payload.search_id),
    user_id: String((search as any)?.user_id || payload.user_id),
    product_service: String((search as any)?.product_service || ''),
    industries: Array.isArray((search as any)?.industries) ? ((search as any).industries as string[]) : [],
    countries: Array.isArray((search as any)?.countries) ? ((search as any).countries as string[]) : [],
    search_type: ((search as any)?.search_type === 'supplier' ? 'supplier' : 'customer') as 'customer' | 'supplier'
  };
  return await runBusinessDiscovery(agentSearch);
}