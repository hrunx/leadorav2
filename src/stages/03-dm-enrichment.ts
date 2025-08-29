import { supaServer } from '../lib/supaServer';
import { processBusinessForDM } from '../tools/instant-dm-discovery';
import logger from '../lib/logger';

export async function runDMEnrichment({ search_id, user_id }:{ search_id:string; user_id:string }) {
  const supa = supaServer();
  logger.info('[DM] enrichment start', { search_id, user_id });
  const { data: biz, error } = await supa
    .from('businesses')
    .select('id,name,industry,country')
    .eq('search_id', search_id)
    .limit(200);
  if (error) throw error;
  let i = 0;
  for (const b of biz || []) {
    try {
      logger.debug('[DM] processing business', { id: (b as any).id, name: (b as any).name });
      await processBusinessForDM(search_id, user_id, b as any);
    } catch (e:any) { logger.warn('[DM] processBusinessForDM failed', { error: e?.message || e }); }
    i++;
  }
  logger.info('[DM] enrichment done', { processed: i });
  return i;
}
