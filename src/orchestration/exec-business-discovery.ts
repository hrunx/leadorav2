import { runBusinessDiscovery } from '../agents/business-discovery.agent';
import { loadSearch, loadBusinesses } from '../tools/db.read';
import logger from '../lib/logger';

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
  // Run the primary discovery flow
  await runBusinessDiscovery(agentSearch);
  
  // Guard: if still no businesses, force insert via debug discovery endpoint (aggregates Serper, Google Places, CSE)
  try {
    const after = await loadBusinesses(agentSearch.id);
    if (!after || after.length === 0) {
      // Try remote base first (if provided), then fallback to local dev base
      const localBase = process.env.LOCAL_BASE_URL || 'http://localhost:8888';
      const bases = [process.env.URL, process.env.DEPLOY_URL, localBase].filter(Boolean) as string[];
      let ok = false;
      for (const b of bases) {
        try {
          const res = await fetch(`${b}/.netlify/functions/debug-business-discovery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ search_id: agentSearch.id, insert: true })
          });
          if (res.ok) { ok = true; break; }
          logger.warn('debug-business-discovery guard non-OK', { base: b, status: res.status });
        } catch (e:any) {
          logger.warn('debug-business-discovery guard fetch failed', { base: b, error: e?.message || e });
        }
      }
      if (!ok) logger.warn('debug-business-discovery guard failed across all bases');
    }
  } catch (e:any) {
    logger.warn('execBusinessDiscovery guard failed', { error: e?.message || e });
  }
  return true;
}