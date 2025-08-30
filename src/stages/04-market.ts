import { respondJSON } from '../lib/responsesClient';
import { Market } from '../schemas/market';
import { supaServer } from '../lib/supaServer';
import logger from '../lib/logger';

export async function runMarket({ search_id, user_id, segment, industries, countries, query }:{
  search_id:string; user_id:string; segment:'customers'|'suppliers'; industries:string[]; countries:string[]; query:string;
}) {
  const supa = supaServer();
  const system = 'You are an equity-research grade market analyst. Return rigorous, sourced analysis.';
  const user = `Segment:${segment}\nIndustries:${industries.join(',')}\nCountries:${countries.join(',')}\nProduct/Service:${query}\nReturn numeric values with currency+year context.`;
  logger.info('[MARKET] start', { search_id, segment, industries, countries });
  const out = await respondJSON({ system, user, schema: Market });
  logger.info('[MARKET] got insights', { keys: Object.keys(out || {}).length });
  // Persist: use update-then-insert since there may be no unique constraint on search_id
  const { data: existing, error: selError } = await supa
    .from('market_insights')
    .select('id')
    .eq('search_id', search_id)
    .maybeSingle();
  if (selError) {
    logger.error('[MARKET] select existing failed', { error: selError.message || selError });
    throw selError;
  }
  if (existing && (existing as any).id) {
    const { error: updError } = await supa
      .from('market_insights')
      .update({ user_id, payload: out })
      .eq('id', (existing as any).id);
    if (updError) {
      logger.error('[MARKET] update failed', { error: updError.message || updError });
      throw updError;
    }
    logger.info('[MARKET] updated existing row');
  } else {
    const { error: insError } = await supa
      .from('market_insights')
      .insert({ search_id, user_id, payload: out });
    if (insError) {
      logger.error('[MARKET] insert failed', { error: insError.message || insError });
      throw insError;
    }
    logger.info('[MARKET] inserted new row');
  }
  return true;
}

