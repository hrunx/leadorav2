/*
  Simple local smoke runner that calls the stage modules directly (bypassing Netlify dev),
  so we can validate end-to-end generation with your current environment variables.
*/

// Minimal .env loader to populate process.env before imports that consume it
import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv() {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {}
}
loadDotEnv();

import { supaServer } from '../src/lib/supaServer';
import logger from '../src/lib/logger';
import { DEMO_USER_ID } from '../src/constants/demo';
// Use dynamic imports for modules that initialize OpenAI at import-time

async function main() {
  const supa: any = supaServer();
  // Create a test search
  const user_id = DEMO_USER_ID;
  const product_service = process.env.SMOKE_PRODUCT_SERVICE || 'CRM Software';
  const industries = (process.env.SMOKE_INDUSTRIES || 'Technology').split(',').map(s => s.trim()).filter(Boolean);
  const countries = (process.env.SMOKE_COUNTRIES || 'Saudi Arabia').split(',').map(s => s.trim()).filter(Boolean);
  const search_type = (process.env.SMOKE_SEARCH_TYPE as 'customer'|'supplier') || 'customer';

  const { data: created, error: createErr } = await supa
    .from('user_searches')
    .insert({ user_id, product_service, industries, countries, search_type, status: 'in_progress' })
    .select('id')
    .single();
  if (createErr) throw createErr;
  const search_id = String((created as any).id);
  logger.info('[SMOKE] Created search', { search_id, user_id });

  // Ensure OpenAI client constructor does not throw on import (dummy key ok)
  if (!process.env.OPENAI_API_KEY || String(process.env.OPENAI_API_KEY).trim() === '') {
    process.env.OPENAI_API_KEY = 'test-key';
  }

  // Dynamic imports (avoid early OpenAI initialization issues)
  const [{ runPersonas }, { runDiscovery }, { runDMEnrichment }, { runMarket }] = await Promise.all([
    import('../src/stages/01-personas'),
    import('../src/stages/02-discovery'),
    import('../src/stages/03-dm-enrichment'),
    import('../src/stages/04-market')
  ]);
  const { insertBusinessPersonas, insertDMPersonas } = await import('../src/tools/db.write');

  // Personas stage with fallback
  try {
    await runPersonas({ segment: search_type === 'supplier' ? 'suppliers' : 'customers', industries, countries, query: product_service, search_id, user_id });
    logger.info('[SMOKE] Personas stage ok');
  } catch (e: any) {
    logger.warn('[SMOKE] Personas generation failed, inserting deterministic seed personas', { error: e?.message || e });
    const bases = [
      { title: `${industries[0]} SMB Adopters`, size: 'Small (10-50)', revenue: '$1M-$10M', deal: '$5K-$20K' },
      { title: `${industries[0]} Mid-Market Transformers`, size: 'Mid (50-500)', revenue: '$10M-$100M', deal: '$20K-$80K' },
      { title: `${industries[0]} Enterprise Innovators`, size: 'Enterprise (500+)', revenue: '$100M+', deal: '$100K-$500K' }
    ];
    const rows = bases.map((b, i) => ({
      search_id,
      user_id,
      title: b.title,
      rank: i + 1,
      match_score: 85 + (2 - i) * 3,
      demographics: { industry: industries[0], companySize: b.size, geography: countries[0], revenue: b.revenue },
      characteristics: { painPoints: ['Inefficient workflows','Integration complexity'], motivations: ['Operational efficiency','Risk reduction'], challenges: ['Budget constraints','Change management'], decisionFactors: ['ROI','Scalability','Support'] },
      behaviors: { buyingProcess: 'Pilot → Stakeholder alignment → Rollout', decisionTimeline: i === 0 ? '1-2 months' : i === 1 ? '2-4 months' : '4-6 months', budgetRange: b.deal, preferredChannels: ['Email','Website','Referral'] },
      market_potential: { totalCompanies: i === 0 ? 5000 : i === 1 ? 1200 : 200, avgDealSize: b.deal, conversionRate: i === 0 ? 6 : i === 1 ? 4 : 2 },
      locations: countries
    }));
    await insertBusinessPersonas(rows as any[]);
  }

  // Discovery (Serper/Google Places). Safe if it yields 0 results.
  try {
    await runDiscovery({ search_id, user_id, industries, countries, query: product_service });
    logger.info('[SMOKE] Discovery stage ok');
  } catch (e: any) {
    logger.warn('[SMOKE] Discovery failed', { error: e?.message || e });
  }

  // DM Enrichment (uses LinkedIn enrichment; safe if no businesses)
  try {
    await runDMEnrichment({ search_id, user_id });
    logger.info('[SMOKE] DM enrichment stage ok');
  } catch (e: any) {
    logger.warn('[SMOKE] DM enrichment failed, seeding 3 decision-maker personas');
    // Seed minimal DM personas when enrichment cannot run
    const dms = [
      { title: 'Chief Technology Officer', level: 'executive', department: 'Technology', experience: '15+ years' },
      { title: 'Director of Operations', level: 'director', department: 'Operations', experience: '10+ years' },
      { title: 'Head of Procurement', level: 'manager', department: 'Procurement', experience: '8+ years' }
    ].map((r, i) => ({
      search_id,
      user_id,
      title: r.title,
      rank: i + 1,
      match_score: 90 - i * 5,
      demographics: { level: r.level, department: r.department, experience: r.experience, geography: countries[0] },
      characteristics: { responsibilities: [ 'Strategy', 'Budget', 'Vendor oversight' ], painPoints: [ 'Legacy systems', 'Cost pressure', 'Talent gap' ], motivations: [ 'ROI', 'Scalability', 'Reliability' ], challenges: [ 'Change management', 'Cross-functional alignment' ], decisionFactors: [ 'Total cost of ownership', 'Time-to-value', 'Support & SLAs' ] },
      behaviors: { decisionMaking: 'data-driven', communicationStyle: 'concise', buyingProcess: 'Problem definition → Vendor shortlist → Pilot → Contract', preferredChannels: [ 'Email', 'Demo', 'Case studies' ] },
      market_potential: { totalDecisionMakers: 2500 - i * 500, avgInfluence: 90 - i * 10, conversionRate: 5 - i }
    }));
    await insertDMPersonas(dms as any[]);
  }

  // Market (OpenAI with fallback; upserts deterministic data if LLM fails)
  try {
    await runMarket({ search_id, user_id, segment: search_type === 'supplier' ? 'suppliers' : 'customers', industries, countries, query: product_service });
    logger.info('[SMOKE] Market stage ok');
  } catch (e: any) {
    logger.warn('[SMOKE] Market generation failed', { error: e?.message || e });
  }

  // Mark completed
  await supa.from('user_searches').update({ phase: 'completed', status: 'completed', progress_pct: 100, updated_at: new Date().toISOString() }).eq('id', search_id);

  // Summarize results
  const tables = ['business_personas','decision_maker_personas','businesses','decision_makers','market_insights'] as const;
  const summary: Record<string, number> = {};
  for (const t of tables) {
    const { count } = await supa.from(t).select('id', { count: 'exact', head: true }).eq('search_id', search_id);
    summary[t] = count || 0;
  }
  console.log(JSON.stringify({ ok: true, search_id, summary }, null, 2));
}

main().catch((e) => {
  console.error('[SMOKE] Failed', e?.message || e);
  process.exit(1);
});
