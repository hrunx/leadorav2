import { runDMPersonas } from '../agents/dm-persona.agent';
import { loadSearch } from '../tools/db.read';
import logger from '../lib/logger';

export async function execDMPersonas(payload: {
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
  // extend DM personas timeout budget, and do not block overall if it times out
  try {
    const RUN_TIMEOUT_MS = Math.max(90000, Number(process.env.DMP_AGENT_TIMEOUT_MS || 90000));
    const result = await Promise.race([
      runDMPersonas(agentSearch),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:dm_personas_exec')), RUN_TIMEOUT_MS))
    ]);
    return result as any;
  } catch (err) {
    logger.warn('execDMPersonas failed', { error: (err as any)?.message || err });
    return null as any;
  }
}