import { supaServer } from '../lib/supaServer';
import { embed } from '../lib/embeddings';
import logger from '../lib/logger';
// gl mapping happens inside serper client
import { serperPlaces } from '../tools/serper';
import { quickEnrichBusiness } from '../tools/business-enrichment';

export async function runDiscovery({ search_id, user_id, industries, countries, query }:{ search_id:string; user_id:string; industries:string[]; countries:string[]; query:string; }) {
  const supa: any = supaServer();
  const country = countries[0] || 'United States';
  // countryToGL retained via util for serper internals; explicit gl not needed here
  logger.info('[DISCOVERY] start', { search_id, user_id, country, query });
  // Fetch up to 3 business personas for this search to drive persona-specific discovery
  let personas: Array<{ id: string; title: string; rank: number; match_score?: number; demographics?: { industry?: string } }>
    = [] as any;
  try {
    const { data } = await supa
      .from('business_personas')
      .select('id, title, rank, match_score, demographics')
      .eq('search_id', search_id)
      .eq('user_id', user_id)
      .order('rank', { ascending: true })
      .limit(3);
    personas = Array.isArray(data) ? data as any : [];
  } catch {}

  let totalInserted = 0;

  if (personas.length > 0) {
    logger.info('[DISCOVERY] persona-driven search', { personas: personas.map(p => ({ id: p.id, title: p.title, rank: p.rank })) });
    for (const persona of personas) {
      const personaIndustry = (persona as any)?.demographics?.industry || industries[0] || 'General';
      const qParts = [persona.title, personaIndustry].filter(Boolean);
      const personaQuery = qParts.join(' ');
      const places = await serperPlaces(personaQuery, country, 5).catch((e) => { logger.warn('[DISCOVERY] serper error (persona)', { error: (e as any)?.message || e, persona_id: persona.id }); return []; });
      const arr = Array.isArray(places) ? places : [];
      logger.info('[DISCOVERY] places results (persona)', { count: arr.length, persona_id: persona.id, title: persona.title });
      for (const p of arr) {
        try {
          logger.debug('[DISCOVERY] inserting business (persona)', { name: p.name, persona_id: persona.id });
          const { data: bizRow } = await supa
            .from('businesses')
            .insert({
              search_id,
              user_id,
              name: p.name || 'Unknown',
              industry: personaIndustry,
              country: country,
              address: p.address || null,
              city: p.city || null,
              phone: p.phone || null,
              website: p.website || null,
              rating: typeof p.rating === 'number' ? p.rating : null,
              description: `Seeded via persona: ${persona.title}`,
              match_score: Math.max(60, Math.min(100, Math.round(Number(persona.match_score || 80)))) ,
              persona_id: persona.id,
              persona_type: persona.title
            })
            .select('id')
            .single();

          if (bizRow && (bizRow as any).id) {
            totalInserted += 1;
            logger.debug('[DISCOVERY] embedding for business', { business_id: (bizRow as any).id });
            const vec = await embed([p.name, personaIndustry || '', country, p.address || '', p.website || ''].filter(Boolean).join('\n'));
            // set embedding
            try { await supa.rpc('set_business_embedding', { business_id: (bizRow as any).id, emb: vec as any }); logger.debug('[DISCOVERY] set_business_embedding RPC ok', { business_id: (bizRow as any).id }); }
            catch { await supa.from('businesses').update({ embedding: vec as any }).eq('id', (bizRow as any).id); logger.warn('[DISCOVERY] RPC set_business_embedding failed, wrote column instead', { business_id: (bizRow as any).id }); }

            // Skip vector persona remap because persona_id is already set deterministically
            // Fire-and-forget quick enrichment (no LLM) to populate departments/products/activity
            try { void quickEnrichBusiness((bizRow as any).id); } catch {}
          }
        } catch (e:any) { logger.warn('[DISCOVERY] failed to process place (persona)', { error: e?.message || e, persona_id: persona.id }); }
      }
    }
    logger.info('[DISCOVERY] done (persona-driven)', { inserted: totalInserted });
    return totalInserted;
  }

  // Fallback: generic query-based discovery (legacy)
  const places = await serperPlaces(query, country, 12).catch((e) => { logger.warn('[DISCOVERY] serper error (fallback)', { error: (e as any)?.message || e }); return []; });
  const arr = Array.isArray(places) ? places : [];
  logger.info('[DISCOVERY] places results (fallback)', { count: arr.length });
  for (const p of arr) {
    try {
      logger.debug('[DISCOVERY] inserting business (fallback)', { name: p.name });
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
        totalInserted += 1;
        logger.debug('[DISCOVERY] embedding for business', { business_id: (bizRow as any).id });
        const vec = await embed([p.name, industries[0] || '', country, p.address || '', p.website || ''].filter(Boolean).join('\n'));
        // set embedding
        try { await supa.rpc('set_business_embedding', { business_id: (bizRow as any).id, emb: vec as any }); logger.debug('[DISCOVERY] set_business_embedding RPC ok', { business_id: (bizRow as any).id }); }
        catch { await supa.from('businesses').update({ embedding: vec as any }).eq('id', (bizRow as any).id); logger.warn('[DISCOVERY] RPC set_business_embedding failed, wrote column instead', { business_id: (bizRow as any).id }); }

        // persona mapping via RPC
        try {
          const { data: match } = await supa.rpc('match_business_best_persona', { business_id: (bizRow as any).id }).maybeSingle();
          if (match && (match as any).persona_id) {
            const personaId = (match as any).persona_id as string;
            const score01 = Number((match as any).score || 0);
            const scorePct = Math.max(60, Math.min(100, Math.round(score01 * 100)));
            let personaTitle: string | undefined = undefined;
            try {
              const { data: p } = await supa.from('business_personas').select('title').eq('id', personaId).maybeSingle();
              personaTitle = (p as any)?.title;
            } catch {}
            await supa.from('businesses').update({ persona_id: personaId, persona_type: personaTitle || 'mapped', match_score: scorePct }).eq('id', (bizRow as any).id);
            logger.debug('[DISCOVERY] match_business_best_persona ok', { business_id: (bizRow as any).id, scorePct });
          }
        } catch {}

        // Fire-and-forget quick enrichment (no LLM) to populate departments/products/activity
        try { void quickEnrichBusiness((bizRow as any).id); } catch {}
      }
    } catch (e:any) { logger.warn('[DISCOVERY] failed to process place (fallback)', { error: e?.message || e }); }
  }
  logger.info('[DISCOVERY] done (fallback)', { inserted: totalInserted });
  return totalInserted;
}
