import { supaServer } from '../lib/supaServer';
import { embed } from '../lib/embeddings';
import logger from '../lib/logger';
// gl mapping happens inside serper client
import { serperPlaces } from '../tools/serper';

export async function runDiscovery({ search_id, user_id, industries, countries, query }:{ search_id:string; user_id:string; industries:string[]; countries:string[]; query:string; }) {
  const supa: any = supaServer();
  const country = countries[0] || 'United States';
  // countryToGL retained via util for serper internals; explicit gl not needed here
  logger.info('[DISCOVERY] start', { search_id, user_id, country, query });
  const places = await serperPlaces(query, country, 12).catch((e) => { logger.warn('[DISCOVERY] serper error', { error: (e as any)?.message || e }); return []; });
  const arr = Array.isArray(places) ? places : [];
  logger.info('[DISCOVERY] places results', { count: arr.length });
  for (const p of arr) {
    try {
      logger.debug('[DISCOVERY] inserting business', { name: p.name });
      const { data: bizRow } = await supa
        .from('businesses')
        .insert({
          search_id,
          user_id,
          name: p.name || 'Unknown',
          industry: industries[0] || 'General',
          country: country,
          address: p.address || null,
          city: p.city || null,
          phone: p.phone || null,
          website: p.website || null,
          rating: typeof p.rating === 'number' ? p.rating : null,
          description: p.name || '',
          match_score: 75,
          persona_type: 'business'
        })
        .select('id')
        .single();

      if (bizRow && (bizRow as any).id) {
        logger.debug('[DISCOVERY] embedding for business', { business_id: (bizRow as any).id });
        const vec = await embed([p.name, industries[0] || '', country, p.address || '', p.website || ''].filter(Boolean).join('\n'));
        // set embedding
        try { await supa.rpc('set_business_embedding', { business_id: (bizRow as any).id, emb: vec as any }); logger.debug('[DISCOVERY] set_business_embedding RPC ok', { business_id: (bizRow as any).id }); }
        catch { await supa.from('businesses').update({ embedding: vec as any }).eq('id', (bizRow as any).id); logger.warn('[DISCOVERY] RPC set_business_embedding failed, wrote column instead', { business_id: (bizRow as any).id }); }

        // persona mapping via RPC
        try {
          const { data: match } = await supa.rpc('match_business_best_persona', { business_id: (bizRow as any).id }).maybeSingle();
          if (match) { await supa.from('businesses').update({ persona_id: (match as any).persona_id, match_score: (match as any).score }).eq('id', (bizRow as any).id); logger.debug('[DISCOVERY] match_business_best_persona ok', { business_id: (bizRow as any).id, score: (match as any).score }); }
        } catch {}
      }
    } catch (e:any) { logger.warn('[DISCOVERY] failed to process place', { error: e?.message || e }); }
  }
  logger.info('[DISCOVERY] done', { inserted: arr.length });
  return arr.length;
}
