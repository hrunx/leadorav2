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
    const { execBusinessDiscovery } = await import('../orchestration/exec-business-discovery');
    await execBusinessDiscovery({ search_id: String(input.search_id), user_id: String(input.user_id) });
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
    const { execDMPersonas } = await import('../orchestration/exec-dm-personas');
    await execDMPersonas({ search_id: String(input.search_id), user_id: String(input.user_id) });
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
    const { execMarketResearchParallel } = await import('../orchestration/exec-market-research-parallel');
    await execMarketResearchParallel({ search_id: String(input.search_id), user_id: String(input.user_id) });
    return { ok: true } as const;
  }
});

export const OrchestratorAgent = new Agent({
  name: 'MainOrchestratorAgent',
  tools: [startBusinessPersonas, startDMPersonas, startBusinessDiscovery, startMarketResearch],
  model: 'gpt-4o-mini',
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


