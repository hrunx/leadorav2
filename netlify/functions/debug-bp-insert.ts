import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  } as const;
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  try {
    const { search_id } = JSON.parse(event.body || '{}');
    if (!search_id) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'search_id required' }) };
    const [{ loadSearch, loadBusinesses }, { insertBusinessPersonas }] = await Promise.all([
      import('../../src/tools/db.read'),
      import('../../src/tools/db.write'),
    ]);
    const s = await loadSearch(String(search_id));
    const businesses = await loadBusinesses(String(search_id));
    const user_id = String(s.user_id || '00000000-0000-0000-0000-000000000001');
    const industries = Array.isArray(s.industries) ? s.industries : [];
    const countries = Array.isArray(s.countries) ? s.countries : [];
    const countryLabel = countries.join(', ') || 'Global';
    const industryLabel = industries[0] || 'General';
    const mk = (rank: number) => ({
      search_id: String(search_id),
      user_id,
      title: s.search_type === 'supplier'
        ? `${rank===1?'Tier-1':rank===2?'Regional':'Boutique'} Providers for ${s.product_service} in ${industryLabel}`
        : `${rank===1?'Enterprise':rank===2?'Mid-Market':'SMB'} ${industryLabel} Adopters of ${s.product_service}`,
      rank,
      match_score: rank===1?92:rank===2?86:82,
      demographics: { industry: industryLabel, companySize: rank===1?'1000-5000+':rank===2?'200-1000':'10-200', geography: countryLabel, revenue: rank===1?'$100M-$1B+':rank===2?'$20M-$100M':'$1M-$20M' },
      characteristics: { painPoints: ['Integration complexity','Legacy constraints','Cost of ownership'], motivations: ['ROI','Efficiency','Scalability'], challenges: ['Change management','Talent gaps','Security/compliance'], decisionFactors: ['Total cost','Integration ease','Security','Time-to-value'] },
      behaviors: { buyingProcess: 'Committee-based evaluation with pilot', decisionTimeline: rank===1?'3-6 months':rank===2?'2-4 months':'1-3 months', budgetRange: rank===1?'$500k-$2M':rank===2?'$150k-$500k':'$25k-$150k', preferredChannels: rank===1?['Executive briefings','RFP/RFQ','Industry events']:(rank===2?['Demos','Case studies','Email']:['Webinars','Inbound content','Live chat']) },
      market_potential: { totalCompanies: Math.max(businesses.length*10, 50), avgDealSize: rank===1?'$500k-$2M':rank===2?'$150k-$500k':'$25k-$150k', conversionRate: rank===1?8:rank===2?12:18 },
      locations: [countryLabel]
    });
    try {
      const rows = [mk(1), mk(2), mk(3)];
      const inserted = await insertBusinessPersonas(rows);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, inserted: inserted?.length || 0 }) };
    } catch (e: any) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: e?.message || String(e) }) };
    }
  } catch (e: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e?.message || String(e) }) };
  }
};


