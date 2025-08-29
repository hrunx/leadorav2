import { z } from 'zod';
import { respondJSON } from '../lib/responsesClient';
import { PersonasOut } from '../schemas/personas';
import { supaServer } from '../lib/supaServer';
import { embed } from '../lib/embeddings';
import logger from '../lib/logger';

const Input = z.object({
  segment: z.enum(['customers','suppliers']),
  industries: z.array(z.string()).min(1),
  countries: z.array(z.string()).min(1),
  query: z.string().min(2),
  search_id: z.string(),
  user_id: z.string()
});

export type PersonasInput = z.infer<typeof Input>;

export async function runPersonas(input: PersonasInput) {
  const parsed = Input.parse(input);
  const supa: any = supaServer();
  const system = 'You are a precise B2B segmentation engine. Return exactly 3 distinct, concise personas.';
  const user = `Segment:${parsed.segment}\nIndustries:${parsed.industries.join(', ')}\nCountries:${parsed.countries.join(', ')}\nSearch:${parsed.query}`;
  console.info('[PERSONAS] calling respondJSON', { segment: parsed.segment, industries: parsed.industries, countries: parsed.countries });
  const out = await respondJSON({ system, user, schema: PersonasOut });
  console.info('[PERSONAS] received personas', { count: out.personas?.length || 0 });

  // persist + embed
  let rank = 1;
  for (const p of out.personas) {
    console.info('[PERSONAS] inserting persona', { rank, title: p.title });
    const { data: row } = await supa.from('business_personas')
      .insert({
        search_id: parsed.search_id,
        user_id: parsed.user_id,
        title: p.title,
        rank,
        match_score: 80 - (rank - 1) * 5,
        demographics: {},
        characteristics: {},
        behaviors: {},
        market_potential: {},
        locations: []
      })
      .select('id')
      .single();
    rank += 1;
    const vec = await embed(`${p.title}\n${p.description}`);
    // Prefer RPC setter if present
    try {
      await supa.rpc('set_business_persona_embedding', { persona_id: row!.id, emb: vec as any });
    } catch {
      await supa.from('business_personas').update({ embedding: vec as any }).eq('id', row!.id);
    }
  }

  // Generate Decision Maker personas as well (3 personas for employee roles)
  const systemDM = 'You are a precise B2B ICP engine. Return exactly 3 decision-maker personas (titles/roles) that would influence buying this product/service.';
  const userDM = `Industries:${parsed.industries.join(', ')}\nCountries:${parsed.countries.join(', ')}\nProduct/Service:${parsed.query}\nAudience: decision makers and influencers in target companies.`;
  logger.info('[DM-PERSONAS] calling respondJSON');
  const outDM = await respondJSON({ system: systemDM, user: userDM, schema: PersonasOut });
  logger.info('[DM-PERSONAS] received personas', { count: outDM.personas?.length || 0 });
  let dmRank = 1;
  for (const p of outDM.personas) {
    logger.info('[DM-PERSONAS] inserting', { rank: dmRank, title: p.title });
    const { data: row } = await supa.from('decision_maker_personas')
      .insert({
        search_id: parsed.search_id,
        user_id: parsed.user_id,
        title: p.title,
        rank: dmRank,
        match_score: 85 - (dmRank - 1) * 5,
        demographics: {},
        characteristics: {},
        behaviors: {},
        market_potential: {}
      })
      .select('id')
      .single();
    dmRank += 1;
    const vec = await embed(`${p.title}\n${p.description}`);
    try {
      await supa.rpc('set_decision_maker_persona_embedding', { persona_id: row!.id, emb: vec as any });
    } catch (e:any) {
      try {
        await supa.rpc('set_dm_persona_embedding', { persona_id: row!.id, emb: vec as any });
      } catch {
        await supa.from('decision_maker_personas').update({ embedding: vec as any }).eq('id', row!.id);
      }
    }
  }
  return out;
}

