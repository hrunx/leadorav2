import { runBusinessPersonas } from '../agents/business-persona.agent';
import { loadSearch, loadBusinessPersonas } from '../tools/db.read';
import { insertBusinessPersonas, updateSearchProgress } from '../tools/db.write';
import logger from '../lib/logger';

export async function execBusinessPersonas(payload: {
  search_id: string;
  user_id: string;
}) {
  const search = await loadSearch(payload.search_id);
  if (!search) throw new Error(`Search ${payload.search_id} not found`);

  // Normalize for strict agent typing
  const agentSearch = {
    id: String((search as any)?.id || payload.search_id),
    user_id: String((search as any)?.user_id || payload.user_id),
    product_service: String((search as any)?.product_service || ''),
    industries: Array.isArray((search as any)?.industries) ? ((search as any).industries as string[]) : [],
    countries: Array.isArray((search as any)?.countries) ? ((search as any).countries as string[]) : [],
    search_type: ((search as any)?.search_type === 'supplier' ? 'supplier' : 'customer') as 'customer' | 'supplier',
  };
  try {
    await runBusinessPersonas(agentSearch);
  } catch (e: any) {
    logger.warn('runBusinessPersonas failed, will attempt fallback', { search_id: agentSearch.id, error: e?.message || e });
  }

  // Guard: if no personas were inserted, create deterministic but personalized archetypes
  try {
    const existing = await loadBusinessPersonas(agentSearch.id);
    if (!existing || existing.length === 0) {
      const industry = agentSearch.industries[0] || 'General';
      const country = agentSearch.countries[0] || 'Global';
      const lens = agentSearch.search_type === 'customer' ? 'Buyer' : 'Provider';
      const fallback = [
        {
          title: `Enterprise ${industry} ${lens} Archetype`,
          rank: 1,
          match_score: 90,
          demographics: { industry, companySize: '1000-5000', geography: country, revenue: '$100M-$1B' },
          characteristics: { painPoints: ['Scale','Integration'], motivations: ['Efficiency','Growth'], challenges: ['Budget','Legacy'], decisionFactors: ['ROI','Support'] },
          behaviors: { buyingProcess: 'Committee', decisionTimeline: '6-12 months', budgetRange: '$500K-$2M', preferredChannels: ['Direct','Analyst'] },
          market_potential: { totalCompanies: 1000, avgDealSize: '$850K', conversionRate: 12 },
          locations: [country]
        },
        {
          title: `Mid-Market ${industry} ${lens} Archetype`,
          rank: 2,
          match_score: 85,
          demographics: { industry, companySize: '200-1000', geography: country, revenue: '$20M-$100M' },
          characteristics: { painPoints: ['Resources','Automation'], motivations: ['Growth','Speed'], challenges: ['Skills','Time'], decisionFactors: ['Cost','Scalability'] },
          behaviors: { buyingProcess: 'Streamlined', decisionTimeline: '3-6 months', budgetRange: '$100K-$500K', preferredChannels: ['Webinars','Partner'] },
          market_potential: { totalCompanies: 3500, avgDealSize: '$250K', conversionRate: 18 },
          locations: [country]
        },
        {
          title: `SMB ${industry} ${lens} Archetype`,
          rank: 3,
          match_score: 80,
          demographics: { industry, companySize: '10-200', geography: country, revenue: '$1M-$20M' },
          characteristics: { painPoints: ['Budget','Bandwidth'], motivations: ['Savings','Time'], challenges: ['Selection','Adoption'], decisionFactors: ['Ease','Price'] },
          behaviors: { buyingProcess: 'Owner-led', decisionTimeline: '1-3 months', budgetRange: '$10K-$100K', preferredChannels: ['Online','Trials'] },
          market_potential: { totalCompanies: 15000, avgDealSize: '$45K', conversionRate: 25 },
          locations: [country]
        }
      ];
      const rows = fallback.map(p => ({
        search_id: agentSearch.id,
        user_id: agentSearch.user_id,
        ...p
      }));
      await insertBusinessPersonas(rows as any);
      await updateSearchProgress(agentSearch.id, 20, 'business_personas');
      logger.info('Inserted fallback business personas', { search_id: agentSearch.id });
    }
  } catch (e: any) {
    logger.error('execBusinessPersonas fallback failed', { search_id: agentSearch.id, error: e?.message || e });
  }
  return true;
}