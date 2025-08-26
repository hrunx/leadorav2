import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  try {
    const { search_id } = JSON.parse(event.body || '{}');
    if (!search_id) return { statusCode: 400, headers: cors, body: JSON.stringify({ ok:false, error:'search_id required' }) };

    const [{ loadSearch }, { insertBusinessPersonas, updateSearchProgress }] = await Promise.all([
      import('../../src/tools/db.read'),
      import('../../src/tools/db.write')
    ]);

    const s: any = await loadSearch(String(search_id));
    if (!s) return { statusCode: 404, headers: cors, body: JSON.stringify({ ok:false, error:'search_not_found' }) };

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

    const inserted = await insertBusinessPersonas(rows);
    try { await updateSearchProgress(String(s.id), 10, 'business_personas'); } catch {}
    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok:true, inserted: inserted.length }) };
  } catch (e:any) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error: e?.message || String(e) }) };
  }
};


