import { Agent, tool, run } from '@openai/agents';
import logger from '../lib/logger';

const startBusinessDiscovery = tool({
  name: 'startBusinessDiscovery',
  description: 'Start business discovery for the given search.',
  parameters: {
    type: 'object',
    properties: { search_id: { type: 'string' }, user_id: { type: 'string' } },
    required: ['search_id','user_id'],
    additionalProperties: false
  } as const,
  strict: true,
  execute: async (input: any) => {
    const isLocalDev = String(process.env.NETLIFY_DEV) === 'true' || process.env.NODE_ENV === 'development' || String(process.env.LOCAL_FAST_BP) === '1';
    if (isLocalDev) {
      const [{ loadSearch }, { insertBusinesses, updateSearchProgress }] = await Promise.all([
        import('../tools/db.read'),
        import('../tools/db.write')
      ]);
      const s: any = await loadSearch(String(input.search_id));
      if (!s) return { ok:false, error:'search_not_found' } as any;
      const industry = Array.isArray(s.industries) && s.industries.length ? String(s.industries[0]) : 'General';
      const country = Array.isArray(s.countries) && s.countries.length ? String(s.countries[0]) : 'United States';
      const bases = [
        { name: `${industry} Solutions LLC`, city: 'Main City' },
        { name: `${industry} Tech Corp`, city: 'Capital City' },
        { name: `${industry} Partners Inc`, city: 'Regional Hub' }
      ];
      const rows = bases.map((b, i) => ({
        search_id: s.id,
        user_id: s.user_id,
        name: b.name,
        industry,
        country,
        address: `${b.city}, ${country}`,
        city: b.city,
        size: i === 0 ? 'Small (10-50)' : i === 1 ? 'Mid (50-500)' : 'Enterprise (500+)',
        revenue: i === 0 ? '$1M-$10M' : i === 1 ? '$10M-$100M' : '$100M+',
        description: `Seed business inserted during fast dev path for ${industry}`,
        match_score: 80 + (2 - i) * 3,
        persona_type: (s.search_type === 'supplier' ? 'supplier' : 'customer')
      }));
      await insertBusinesses(rows as any);
      try { await updateSearchProgress(String(s.id), 25, 'business_discovery'); } catch {}
    } else {
      const { execBusinessDiscovery } = await import('../orchestration/exec-business-discovery');
      await execBusinessDiscovery({ search_id: String(input.search_id), user_id: String(input.user_id) });
    }
    return { ok: true } as const;
  }
});

const startBusinessPersonas = tool({
  name: 'startBusinessPersonas',
  description: 'Generate and store exactly 3 business personas.',
  parameters: {
    type: 'object',
    properties: { search_id: { type: 'string' }, user_id: { type: 'string' } },
    required: ['search_id','user_id'],
    additionalProperties: false
  } as const,
  strict: true,
  execute: async (input: any) => {
    const isLocalDev = String(process.env.NETLIFY_DEV) === 'true' || process.env.NODE_ENV === 'development' || String(process.env.LOCAL_FAST_BP) === '1';
    if (isLocalDev) {
      const [{ loadSearch }, { insertBusinessPersonas, updateSearchProgress }] = await Promise.all([
        import('../tools/db.read'),
        import('../tools/db.write')
      ]);
      const s: any = await loadSearch(String(input.search_id));
      if (!s) return { ok:false, error:'search_not_found' } as any;
      const industry = Array.isArray(s.industries) && s.industries.length ? String(s.industries[0]) : 'General';
      const country = Array.isArray(s.countries) && s.countries.length ? String(s.countries[0]) : 'United States';
      const type = (s.search_type === 'supplier' ? 'supplier' : 'customer') as 'customer'|'supplier';
      const bases = (
        type === 'customer'
          ? [
              { title: `${industry} SMB Adopters`, size: 'Small (10-50)', revenue: '$1M-$10M', deal: '$5K-$20K' },
              { title: `${industry} Mid-Market Transformers`, size: 'Mid (50-500)', revenue: '$10M-$100M', deal: '$20K-$80K' },
              { title: `${industry} Enterprise Innovators`, size: 'Enterprise (500+)', revenue: '$100M+', deal: '$100K-$500K' }
            ]
          : [
              { title: `${industry} Niche Suppliers`, size: 'Small (10-50)', revenue: '$1M-$10M', deal: '$5K-$20K' },
              { title: `${industry} Regional Vendors`, size: 'Mid (50-500)', revenue: '$10M-$100M', deal: '$20K-$80K' },
              { title: `${industry} National Providers`, size: 'Enterprise (500+)', revenue: '$100M+', deal: '$100K-$500K' }
            ]
      );
      const rows = bases.map((b, i) => ({
        search_id: s.id,
        user_id: s.user_id,
        title: b.title,
        rank: i + 1,
        match_score: 85 + (2 - i) * 3,
        demographics: { industry, companySize: b.size, geography: country, revenue: b.revenue },
        characteristics: {
          painPoints: [ type === 'customer' ? 'Inefficient workflows' : 'Lead volatility', 'Integration complexity' ],
          motivations: [ type === 'customer' ? 'Operational efficiency' : 'Recurring revenue', 'Risk reduction' ],
          challenges: ['Budget constraints','Change management'],
          decisionFactors: ['ROI','Scalability','Support']
        },
        behaviors: {
          buyingProcess: type === 'customer' ? 'Pilot → Stakeholder alignment → Rollout' : 'RFP → Sample → Contract',
          decisionTimeline: i === 0 ? '1-2 months' : i === 1 ? '2-4 months' : '4-6 months',
          budgetRange: b.deal,
          preferredChannels: ['Email','Website','Referral']
        },
        market_potential: { totalCompanies: i === 0 ? 5000 : i === 1 ? 1200 : 200, avgDealSize: b.deal, conversionRate: i === 0 ? 6 : i === 1 ? 4 : 2 },
        locations: [country]
      }));
      await insertBusinessPersonas(rows as any);
      try { await updateSearchProgress(String(s.id), 10, 'business_personas'); } catch {}
    } else {
      const { execBusinessPersonas } = await import('../orchestration/exec-business-personas');
      await execBusinessPersonas({ search_id: String(input.search_id), user_id: String(input.user_id) });
    }
    return { ok: true } as const;
  }
});

const startDMPersonas = tool({
  name: 'startDMPersonas',
  description: 'Generate and store exactly 3 decision-maker personas.',
  parameters: {
    type: 'object',
    properties: { search_id: { type: 'string' }, user_id: { type: 'string' } },
    required: ['search_id','user_id'],
    additionalProperties: false
  } as const,
  strict: true,
  execute: async (input: any) => {
    const isLocalDev = String(process.env.NETLIFY_DEV) === 'true' || process.env.NODE_ENV === 'development' || String(process.env.LOCAL_FAST_BP) === '1';
    if (isLocalDev) {
      const [{ loadSearch }, { insertDMPersonas, updateSearchProgress }] = await Promise.all([
        import('../tools/db.read'),
        import('../tools/db.write')
      ]);
      const s: any = await loadSearch(String(input.search_id));
      if (!s) return { ok:false, error:'search_not_found' } as any;
      const rows = [
        { title: 'IT Manager', rank: 1 },
        { title: 'Operations Director', rank: 2 },
        { title: 'Head of Sales', rank: 3 }
      ].map((b, i) => ({
        search_id: s.id,
        user_id: s.user_id,
        title: b.title,
        rank: b.rank,
        match_score: 85 + (2 - i) * 3,
        demographics: { department: b.title.includes('IT') ? 'IT' : b.title.includes('Sales') ? 'Sales' : 'Operations' },
        characteristics: { motivations: ['Efficiency','ROI'] },
        behaviors: { decisionTimeline: i === 0 ? '2-4 months' : i === 1 ? '1-3 months' : '3-6 months' },
        market_potential: { influence_level: 7 + (2 - i) }
      }));
      await insertDMPersonas(rows as any);
      try { await updateSearchProgress(String(s.id), 20, 'dm_personas'); } catch {}
    } else {
      const { execDMPersonas } = await import('../orchestration/exec-dm-personas');
      await execDMPersonas({ search_id: String(input.search_id), user_id: String(input.user_id) });
    }
    return { ok: true } as const;
  }
});

const startMarketResearch = tool({
  name: 'startMarketResearch',
  description: 'Run market research and store insights via agent.',
  parameters: {
    type: 'object',
    properties: { search_id: { type: 'string' }, user_id: { type: 'string' } },
    required: ['search_id','user_id'],
    additionalProperties: false
  } as const,
  strict: true,
  execute: async (input: any) => {
    const isLocalDev = String(process.env.NETLIFY_DEV) === 'true' || process.env.NODE_ENV === 'development' || String(process.env.LOCAL_FAST_BP) === '1';
    if (isLocalDev) {
      const [{ loadSearch }, { insertMarketInsights, updateSearchProgress }] = await Promise.all([
        import('../tools/db.read'),
        import('../tools/db.write')
      ]);
      const s: any = await loadSearch(String(input.search_id));
      if (!s) return { ok:false, error:'search_not_found' } as any;
      const row = {
        search_id: String(s.id),
        user_id: String(s.user_id),
        tam_data: { value: '$2.4B', growth: '+12%', description: 'Total market', calculation: 'Aggregated reports', source: 'https://example.com/tam' },
        sam_data: { value: '$450M', growth: '+10%', description: 'Serviceable market', calculation: 'Segment share', source: 'https://example.com/sam' },
        som_data: { value: '$60M', growth: '+8%', description: 'Obtainable market', calculation: 'Realistic penetration', source: 'https://example.com/som' },
        competitor_data: [ { name: 'Leader Corp', marketShare: 20, revenue: '$800M', growth: '+5%', source: 'https://example.com/comp' } ],
        trends: [ { trend: 'Digital adoption', impact: 'High', growth: '+15%', description: 'Strong digitization trend', source: 'https://example.com/trend' } ],
        opportunities: { summary: 'Strong SMB adoption potential', playbook: ['Target SMB', 'Bundle integrations'], market_gaps: ['Underserved regions'], timing: 'Favorable' },
        sources: [ { title: 'Seed Source', url: 'https://example.com' } ],
        analysis_summary: 'Seed market insights for fast dev path',
        research_methodology: 'Seeded for local testing'
      } as any;
      await insertMarketInsights(row);
      try { await updateSearchProgress(String(s.id), 80, 'market_research'); } catch {}
    } else {
      const { execMarketResearchParallel } = await import('../orchestration/exec-market-research-parallel');
      await execMarketResearchParallel({ search_id: String(input.search_id), user_id: String(input.user_id) });
    }
    return { ok: true } as const;
  }
});

export const OrchestratorAgent = new Agent({
  name: 'MainOrchestratorAgent',
  tools: [startBusinessPersonas, startDMPersonas, startBusinessDiscovery, startMarketResearch],
  model: 'gpt-5-mini',
  handoffDescription: 'Coordinates sub-agents to complete a search run',
  handoffs: [],
  instructions: `You orchestrate the entire search pipeline. Steps:
1) Call startBusinessPersonas once.
2) Call startDMPersonas once.
3) Call startBusinessDiscovery once.
4) Call startMarketResearch once.
Do not repeat tools. Do not output anything.`,
});

export async function runOrchestratorAgent(params: { search_id: string; user_id: string }) {
  const msg = `search_id=${params.search_id} user_id=${params.user_id}`;
  await run(OrchestratorAgent, msg);
}


