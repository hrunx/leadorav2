import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, apikey, X-Requested-With',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  try {
    const { search_id, user_id } = JSON.parse(event.body || '{}');
    if (!search_id || !user_id) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ ok:false, error: 'search_id and user_id required' }) };
    }
    const rows = [1,2,3].map((i)=>({
      search_id,
      user_id,
      title: `Debug Persona ${i}`,
      rank: i,
      match_score: 85 + i,
      demographics: { industry: 'Technology', companySize: 'SMB', geography: 'US', revenue: '$5M-$20M' },
      characteristics: { painPoints: ['debug'], motivations: ['debug'], challenges: ['debug'], decisionFactors: ['debug'] },
      behaviors: { buyingProcess: 'debug', decisionTimeline: 'Q1', budgetRange: '$10k-$50k', preferredChannels: ['email'] },
      market_potential: { totalCompanies: 1000, avgDealSize: '$20k', conversionRate: 10 },
      locations: ['San Francisco, CA']
    }));

    const { data, error } = await supa
      .from('business_personas')
      .insert(rows)
      .select('id,title,rank');
    if (error) throw error;

    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok:true, inserted: data?.length || 0 }) };
  } catch (e:any) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error: e?.message || String(e) }) };
  }
};
