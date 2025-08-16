import { runBusinessPersonas } from '../agents/business-persona.agent';
import { loadSearch, loadBusinessPersonas } from '../tools/db.read';
// import { insertBusinessPersonas, updateSearchProgress } from '../tools/db.write';
import logger from '../lib/logger';

export async function execBusinessPersonas(payload: {
  search_id: string;
  user_id: string;
}) {
  const search = await loadSearch(payload.search_id);
  if (!search) throw new Error(`Search ${payload.search_id} not found`);

  // Normalize for strict agent typing
  const agentSearch = {
    id: String((search as any)?.id || payload.search_id),
    user_id: String((search as any)?.user_id || payload.user_id),
    product_service: String((search as any)?.product_service || ''),
    industries: Array.isArray((search as any)?.industries) ? ((search as any).industries as string[]) : [],
    countries: Array.isArray((search as any)?.countries) ? ((search as any).countries as string[]) : [],
    search_type: ((search as any)?.search_type === 'supplier' ? 'supplier' : 'customer') as 'customer' | 'supplier',
  };
  try {
    await runBusinessPersonas(agentSearch);
  } catch (e: any) {
    logger.warn('runBusinessPersonas failed, will attempt fallback', { search_id: agentSearch.id, error: e?.message || e });
  }

  // Guard: if no personas were inserted, DO NOT insert generic archetypes. Leave empty to reflect failure and allow retriers.
  try {
    const existing = await loadBusinessPersonas(agentSearch.id);
    if (!existing || existing.length === 0) {
      logger.warn('No business personas generated; skipping generic fallback', { search_id: agentSearch.id });
    }
  } catch (e: any) {
    logger.error('execBusinessPersonas finalization check failed', { search_id: agentSearch.id, error: e?.message || e });
  }
  return true;
}