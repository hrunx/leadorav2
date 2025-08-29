import { supaServer } from '../lib/supaServer';
import { processBusinessForDM } from '../tools/instant-dm-discovery';

export async function runDMEnrichment({ search_id, user_id }:{ search_id:string; user_id:string }) {
  const supa = supaServer();
  const { data: biz, error } = await supa
    .from('businesses')
    .select('id,name,industry,country')
    .eq('search_id', search_id)
    .limit(200);
  if (error) throw error;
  let i = 0;
  for (const b of biz || []) {
    try {
      await processBusinessForDM(search_id, user_id, b as any);
    } catch {}
    i++;
  }
  return i;
}
