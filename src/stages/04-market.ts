import { respondJSON } from '../lib/responsesClient';
import { Market } from '../schemas/market';
import { supaServer } from '../lib/supaServer';

export async function runMarket({ search_id, user_id, segment, industries, countries, query }:{
  search_id:string; user_id:string; segment:'customers'|'suppliers'; industries:string[]; countries:string[]; query:string;
}) {
  const supa = supaServer();
  const system = 'You are an equity-research grade market analyst. Return rigorous, sourced analysis.';
  const user = `Segment:${segment}\nIndustries:${industries.join(',')}\nCountries:${countries.join(',')}\nProduct/Service:${query}\nReturn numeric values with currency+year context.`;
  const out = await respondJSON({ system, user, schema: Market });
  await supa
    .from('market_insights')
    .upsert({ search_id, user_id, payload: out, updated_at: new Date().toISOString() }, { onConflict: 'search_id' });
  return true;
}

