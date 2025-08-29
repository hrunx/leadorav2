import { supaServer } from '../lib/supaServer';
import { embed } from '../lib/embeddings';
// gl mapping happens inside serper client
import { serperPlaces } from '../tools/serper';

export async function runDiscovery({ search_id, user_id, industries, countries, query }:{ search_id:string; user_id:string; industries:string[]; countries:string[]; query:string; }) {
  const supa = supaServer();
  const country = countries[0] || 'United States';
  // countryToGL retained via util for serper internals; explicit gl not needed here
  const places = await serperPlaces(query, country, 12).catch(() => []);
  const arr = Array.isArray(places) ? places : [];
  for (const p of arr) {
    try {
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

      if (bizRow && bizRow.id) {
        const vec = await embed([p.name, industries[0] || '', country, p.address || '', p.website || ''].filter(Boolean).join('\n'));
        // set embedding
        try { await supa.rpc('set_business_embedding', { business_id: bizRow.id, emb: vec as any }); }
        catch { await supa.from('businesses').update({ embedding: vec as any }).eq('id', bizRow.id); }

        // persona mapping via RPC
        try {
          const { data: match } = await supa.rpc('match_business_best_persona', { business_id: bizRow.id }).maybeSingle();
          if (match) await supa.from('businesses').update({ persona_id: (match as any).persona_id, match_score: (match as any).score }).eq('id', bizRow.id);
        } catch {}
      }
    } catch {}
  }
  return arr.length;
}
