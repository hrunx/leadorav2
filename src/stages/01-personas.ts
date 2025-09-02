import { z } from 'zod';
import { respondJSON } from '../lib/responsesClient';
import { PersonasOut } from '../schemas/personas';
import { supaServer } from '../lib/supaServer';
import { embed } from '../lib/embeddings';
import logger from '../lib/logger';
import { sanitizePersona, type SearchContext } from '../tools/persona-validation';

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
  const system = 'You are a precise B2B segmentation engine. Return exactly 3 distinct company personas (describe the type of business).';
  const user = `Segment:${parsed.segment}\nIndustries:${parsed.industries.join(', ')}\nCountries:${parsed.countries.join(', ')}\nProduct/Service:${parsed.query}\n\nDefine each persona as a company profile: industry niche, typical size, geography, purchase triggers, budget range, and decision criteria. Titles should be company-style (e.g., "Mid-market Systems Integrator (KSA)").`;
  console.info('[PERSONAS] calling respondJSON', { segment: parsed.segment, industries: parsed.industries, countries: parsed.countries });
  const out = await respondJSON({ system, user, schema: PersonasOut });
  console.info('[PERSONAS] received personas', { count: out.personas?.length || 0 });

  // persist + embed
  let rank = 1;
  const ctx: SearchContext = {
    industries: parsed.industries,
    countries: parsed.countries,
    search_type: parsed.segment === 'customers' ? 'customer' : 'supplier'
  };
  for (const p of out.personas) {
    console.info('[PERSONAS] inserting persona', { rank, title: p.title });
    const companySizeMap: Record<string, string> = { Small: '1-50', Mid: '51-500', Enterprise: '500+' };
    const seed = {
      title: p.title,
      demographics: {
        industry: parsed.industries[0] || '',
        companySize: companySizeMap[(p as any)?.company_size] || '',
        geography: parsed.countries[0] || '',
        revenue: ''
      },
      characteristics: {
        painPoints: [],
        motivations: [],
        challenges: [],
        decisionFactors: Array.isArray((p as any)?.decision_criteria) ? (p as any).decision_criteria : []
      },
      behaviors: { buyingProcess: '', decisionTimeline: '', budgetRange: '', preferredChannels: [] },
      market_potential: { totalCompanies: 0, avgDealSize: '', conversionRate: 0 },
      locations: parsed.countries
    } as any;
    const sanitized = sanitizePersona('business', seed, rank - 1, ctx);
    const matchScore = Math.max(70, 85 - (rank - 1) * 5);

    const { data: row } = await supa.from('business_personas')
      .insert({
        search_id: parsed.search_id,
        user_id: parsed.user_id,
        title: sanitized.title,
        rank,
        match_score: matchScore,
        demographics: sanitized.demographics,
        characteristics: sanitized.characteristics,
        behaviors: sanitized.behaviors,
        market_potential: sanitized.market_potential,
        locations: sanitized.locations
      })
      .select('id')
      .single();
    rank += 1;
    const vec = await embed(`${p.title}\n${(p as any)?.description || ''}\n${JSON.stringify(sanitized)}`);
    // Prefer RPC setter if present
    try {
      await supa.rpc('set_business_persona_embedding', { persona_id: row!.id, emb: vec as any });
    } catch {
      await supa.from('business_personas').update({ embedding: vec as any }).eq('id', row!.id);
    }
  }

  // Generate Decision Maker personas as well (3 personas for employee roles)
  const systemDM = 'You are a precise B2B ICP engine. Return exactly 3 decision-maker personas (titles/roles) for the target companies described above.';
  const userDM = `Industries:${parsed.industries.join(', ')}\nCountries:${parsed.countries.join(', ')}\nProduct/Service:${parsed.query}\nAudience: decision makers and influencers in companies matching the business personas. Include description with responsibilities, KPIs, and buying criteria.`;
  logger.info('[DM-PERSONAS] calling respondJSON');
  const outDM = await respondJSON({ system: systemDM, user: userDM, schema: PersonasOut });
  logger.info('[DM-PERSONAS] received personas', { count: outDM.personas?.length || 0 });
  let dmRank = 1;
  for (const p of outDM.personas) {
    logger.info('[DM-PERSONAS] inserting', { rank: dmRank, title: p.title });
    const title = (p as any)?.title || '';
    const det = {
      title,
      demographics: {
        level: /chief|vp|head|c\w+o/i.test(title) ? 'executive' : (/director/i.test(title) ? 'director' : 'manager'),
        department: /it|tech|engineering/i.test(title) ? 'Technology' : (/marketing/i.test(title) ? 'Marketing' : (/sales/i.test(title) ? 'Sales' : 'Operations')),
        experience: '10+ years',
        geography: parsed.countries[0] || ''
      },
      characteristics: {
        responsibilities: [],
        painPoints: [],
        motivations: [],
        challenges: [],
        decisionFactors: Array.isArray((p as any)?.decision_criteria) ? (p as any).decision_criteria : []
      },
      behaviors: { decisionMaking: 'data-driven', communicationStyle: 'concise', buyingProcess: 'committee', preferredChannels: ['Email','LinkedIn'] },
      market_potential: { totalDecisionMakers: 0, avgInfluence: 0, conversionRate: 0 }
    } as any;
    const sanitizedDM = sanitizePersona('dm', det, dmRank - 1, ctx);
    const dmScore = Math.max(70, 88 - (dmRank - 1) * 5);

    const { data: row } = await supa.from('decision_maker_personas')
      .insert({
        search_id: parsed.search_id,
        user_id: parsed.user_id,
        title: sanitizedDM.title,
        rank: dmRank,
        match_score: dmScore,
        demographics: sanitizedDM.demographics,
        characteristics: sanitizedDM.characteristics,
        behaviors: sanitizedDM.behaviors,
        market_potential: sanitizedDM.market_potential
      })
      .select('id')
      .single();
    dmRank += 1;
    const vec = await embed(`${p.title}\n${(p as any)?.description || ''}\n${JSON.stringify(sanitizedDM)}`);
    try {
      await supa.rpc('set_decision_maker_persona_embedding', { persona_id: row!.id, emb: vec as any });
    } catch {
      try {
        await supa.rpc('set_dm_persona_embedding', { persona_id: row!.id, emb: vec as any });
      } catch {
        await supa.from('decision_maker_personas').update({ embedding: vec as any }).eq('id', row!.id);
      }
    }
  }
  return out;
}
