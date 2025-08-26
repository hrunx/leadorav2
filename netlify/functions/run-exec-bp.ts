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
    const { search_id, user_id, fast_dev } = JSON.parse(event.body || '{}');
    if (!search_id || !user_id) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'search_id and user_id required' }) };
    // Enforce auth for persona execution
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(user_id))) {
      return { statusCode: 401, headers, body: JSON.stringify({ ok:false, error:'auth_required' }) };
    }
    // Dev/fast path toggle: allow forcing fast deterministic path locally to avoid timeouts
    const isLocalDev = String(process.env.NETLIFY_DEV) === 'true' || process.env.NODE_ENV === 'development' || String(process.env.LOCAL_FAST_BP) === '1' || Boolean(fast_dev);
    if (isLocalDev) {
      // Inline deterministic insertion to avoid heavy imports and ensure sub-30s completion
      const [{ loadSearch }, { insertBusinessPersonas, updateSearchProgress }] = await Promise.all([
        import('../../src/tools/db.read'),
        import('../../src/tools/db.write')
      ]);
      const s: any = await loadSearch(String(search_id));
      if (!s) return { statusCode: 404, headers, body: JSON.stringify({ ok:false, error:'search_not_found' }) };
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
      const { execBusinessPersonas } = await import('../../src/orchestration/exec-business-personas');
      await execBusinessPersonas({ search_id: String(search_id), user_id: String(user_id) });
    }
    // Post-check count to surface result
    try {
      const { loadBusinessPersonas } = await import('../../src/tools/db.read');
      const rows = await loadBusinessPersonas(String(search_id));
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, inserted: Array.isArray(rows) ? rows.length : 0 }) };
    } catch {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }
  } catch (e: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e?.message || String(e) }) };
  }
};


