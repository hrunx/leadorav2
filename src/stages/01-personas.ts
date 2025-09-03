import { z } from 'zod';
import { respondJSON } from '../lib/responsesClient';
import { PersonasOut, BusinessPersonasOut, DMPersonasOut } from '../schemas/personas';
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
  const segmentLabel = parsed.segment === 'suppliers' ? 'SUPPLIER' : 'CUSTOMER';
  const system = 'You are an ICP generator for B2B go-to-market. Output must be JSON that strictly matches the provided Zod schema. Do not include placeholders. Use real-world, segment-specific ICPs.';
  const user = (
    parsed.segment === 'suppliers'
      ? `TASK: Generate exactly 3 supplier ICP personas for sourcing the product/service described.
Context:
- Segment: Suppliers (what types of suppliers exist for this query)
- Product/Service: ${parsed.query}
- Industries: ${parsed.industries.join(', ')}
- Countries: ${parsed.countries.join(', ')}
For each supplier persona, provide:
- demographics: industry (niche), companySize (employees or scale), geography (country/region), revenue (range)
- characteristics: painPoints, motivations, challenges, decisionFactors (what buyers look for in choosing this supplier)
- behaviors: buyingProcess (how THEY sell/procure upstream), decisionTimeline (typical cycle), budgetRange (deal size they close), preferredChannels (how to reach them)
- market_potential: totalCompanies (count in countries), avgDealSize (currency+range), conversionRate (percent)
- locations: list of relevant countries or major hubs
Title should reflect supplier type precisely (e.g., "Upstream Petrochemical Feedstock Distributor (KSA)").`
      : `TASK: Generate exactly 3 customer ICP company personas who would buy the product/service described.
Context:
- Segment: Customers (end-companies that need the offering)
- Product/Service: ${parsed.query}
- Industries: ${parsed.industries.join(', ')}
- Countries: ${parsed.countries.join(', ')}
For each customer persona, provide:
- demographics: industry (niche), companySize, geography, revenue
- characteristics: painPoints, motivations, challenges, decisionFactors (how they select vendors)
- behaviors: buyingProcess (RFP steps), decisionTimeline, budgetRange (typical spend), preferredChannels
- market_potential: totalCompanies (count in countries), avgDealSize, conversionRate
- locations: list of relevant countries or major hubs
Title should be company-type specific (e.g., "Downstream Plastics Converter (KSA)").`
  );
  console.info('[PERSONAS] calling respondJSON', { segment: parsed.segment, industries: parsed.industries, countries: parsed.countries, mode: segmentLabel });
  // Strict schema enforces all UI-required fields
  const out = await respondJSON({ system, user, schema: BusinessPersonasOut });
  console.info('[PERSONAS] received personas', { count: out.personas?.length || 0, mode: segmentLabel });

  // persist + embed
  let rank = 1;
  const ctx: SearchContext = {
    industries: parsed.industries,
    countries: parsed.countries,
    search_type: parsed.segment === 'customers' ? 'customer' : 'supplier'
  };
  for (const p of out.personas) {
    console.info('[PERSONAS] inserting persona', { rank, title: p.title });
    // Use model-provided fields directly; minimal sanitization only
    const seed = {
      title: (p as any).title,
      demographics: (p as any).demographics,
      characteristics: (p as any).characteristics,
      behaviors: (p as any).behaviors,
      market_potential: (p as any).market_potential,
      locations: Array.isArray((p as any).locations) ? (p as any).locations : parsed.countries
    } as any;
    const sanitized = sanitizePersona('business', seed, rank - 1, ctx);
    const matchScore = Math.max(70, 85 - (rank - 1) * 5);

    const { data: row, error: insErr } = await supa.from('business_personas')
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
      .maybeSingle();
    if (insErr) {
      logger.warn('[PERSONAS] insert business_persona failed', { error: insErr.message || String(insErr) });
    }
    let personaId: string | undefined = (row as any)?.id;
    if (!personaId) {
      try {
        const { data: fallback } = await supa
          .from('business_personas')
          .select('id')
          .eq('search_id', parsed.search_id)
          .eq('user_id', parsed.user_id)
          .eq('title', sanitized.title)
          .eq('rank', rank)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        personaId = (fallback as any)?.id;
      } catch {}
    }
    rank += 1;
    if (personaId) {
      const vec = await embed(`${p.title}\n${(p as any)?.description || ''}\n${JSON.stringify(sanitized)}`);
      // Prefer RPC setter if present
      try {
        await supa.rpc('set_business_persona_embedding', { persona_id: personaId, emb: vec as any });
      } catch {
        await supa.from('business_personas').update({ embedding: vec as any }).eq('id', personaId);
      }
    } else {
      logger.warn('[PERSONAS] could not resolve business_persona id for embedding');
    }
  }

  // Generate Decision Maker personas as well (3 personas for employee roles)
  const systemDM = 'You are an expert B2B DM ICP generator. Output must be JSON matching the schema. No placeholders. Make all fields specific to the segment, industry, countries, and product/service.';
  const userDM = `TASK: Generate exactly 3 decision-maker ICP personas for the ${parsed.segment === 'suppliers' ? 'supplier' : 'customer'} context of: ${parsed.query}.
Context:
- Industries: ${parsed.industries.join(', ')}
- Countries: ${parsed.countries.join(', ')}
- Segment: ${parsed.segment}
For each decision maker persona provide:
- demographics: level (e.g., C-level, VP, Director), department, experience (avg years), geography
- characteristics: responsibilities (5-7), painPoints (4-6), motivations (3-5), challenges (3-5), decisionFactors (4-6)
- behaviors: decisionMaking, communicationStyle, buyingProcess (how they evaluate vendors/suppliers), preferredChannels
- market_potential: totalDecisionMakers (count across countries), avgInfluence (percent string), conversionRate (percent string)
Titles must be realistic for the segment (e.g., 'VP Procurement – Downstream Plastics (KSA)' for suppliers; 'Head of Manufacturing Ops – Petrochem (KSA)' for customers).`;
  logger.info('[DM-PERSONAS] calling respondJSON');
  const outDM = await respondJSON({ system: systemDM, user: userDM, schema: DMPersonasOut });
  logger.info('[DM-PERSONAS] received personas', { count: outDM.personas?.length || 0 });
  let dmRank = 1;
  for (const p of outDM.personas) {
    logger.info('[DM-PERSONAS] inserting', { rank: dmRank, title: (p as any)?.title });
    const seedDM = {
      title: (p as any).title,
      demographics: (p as any).demographics,
      characteristics: (p as any).characteristics,
      behaviors: (p as any).behaviors,
      market_potential: (p as any).market_potential
    } as any;
    const sanitizedDM = sanitizePersona('dm', seedDM, dmRank - 1, ctx);
    // prefer model-provided score if present
    const providedScore = Number((p as any).match_score);
    const dmScoreRaw = Number.isFinite(providedScore) && providedScore > 0 ? providedScore : Math.max(70, 88 - (dmRank - 1) * 5);
    const dmScore = Math.round(Math.max(1, Math.min(100, dmScoreRaw)));

    const { data: dmRow, error: dmInsErr } = await supa.from('decision_maker_personas')
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
      .maybeSingle();
    if (dmInsErr) {
      logger.warn('[DM-PERSONAS] insert failed', { error: dmInsErr.message || String(dmInsErr) });
    }
    let dmPersonaId: string | undefined = (dmRow as any)?.id;
    if (!dmPersonaId) {
      try {
        const { data: fb } = await supa
          .from('decision_maker_personas')
          .select('id')
          .eq('search_id', parsed.search_id)
          .eq('user_id', parsed.user_id)
          .eq('title', sanitizedDM.title)
          .eq('rank', dmRank)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        dmPersonaId = (fb as any)?.id;
      } catch {}
    }
    dmRank += 1;
    if (dmPersonaId) {
      const vec = await embed(`${(p as any).title}\n${JSON.stringify(sanitizedDM)}`);
      try {
        await supa.rpc('set_decision_maker_persona_embedding', { persona_id: dmPersonaId, emb: vec as any });
      } catch {
        try {
          await supa.rpc('set_dm_persona_embedding', { persona_id: dmPersonaId, emb: vec as any });
        } catch {
          await supa.from('decision_maker_personas').update({ embedding: vec as any }).eq('id', dmPersonaId);
        }
      }
    } else {
      logger.warn('[DM-PERSONAS] could not resolve decision_maker_persona id for embedding');
    }
  }
  return out;
}
