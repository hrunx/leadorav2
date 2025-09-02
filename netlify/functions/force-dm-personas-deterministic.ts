import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  try {
    const { search_id } = JSON.parse(event.body || '{}');
    if (!search_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'search_id required' }) };
    const supa = createClient(URL, KEY, { auth: { persistSession: false } });
    const { data: s } = await supa.from('user_searches').select('id, user_id, industries, countries').eq('id', search_id).single();
    if (!s) return { statusCode: 404, headers, body: JSON.stringify({ error: 'search_not_found' }) };
    // const industry = Array.isArray(s.industries) && s.industries.length ? String(s.industries[0]) : 'Technology';
    const country = Array.isArray(s.countries) && s.countries.length ? String(s.countries[0]) : 'United States';

    const rows = [
      {
        title: 'Chief Technology Officer',
        level: 'executive', department: 'Technology', experience: '15+ years'
      },
      {
        title: 'Director of Operations',
        level: 'director', department: 'Operations', experience: '10+ years'
      },
      {
        title: 'Head of Procurement',
        level: 'manager', department: 'Procurement', experience: '8+ years'
      }
    ].map((r, i) => ({
      search_id: s.id,
      user_id: s.user_id,
      title: r.title,
      rank: i + 1,
      match_score: 90 - i * 5,
      demographics: { level: r.level, department: r.department, experience: r.experience, geography: country },
      characteristics: {
        responsibilities: [ 'Strategy', 'Budget', 'Vendor oversight' ],
        painPoints: [ 'Legacy systems', 'Cost pressure', 'Talent gap' ],
        motivations: [ 'ROI', 'Scalability', 'Reliability' ],
        challenges: [ 'Change management', 'Cross-functional alignment' ],
        decisionFactors: [ 'Total cost of ownership', 'Time-to-value', 'Support & SLAs' ]
      },
      behaviors: {
        decisionMaking: 'data-driven',
        communicationStyle: 'concise',
        buyingProcess: 'Problem definition → Vendor shortlist → Pilot → Contract',
        preferredChannels: [ 'Email', 'Demo', 'Case studies' ]
      },
      market_potential: {
        totalDecisionMakers: 2500 - i * 500,
        avgInfluence: 90 - i * 10,
        conversionRate: 5 - i
      }
    }));

    const { error: delErr } = await supa.from('decision_maker_personas').delete().eq('search_id', search_id);
    if (delErr) return { statusCode: 500, headers, body: JSON.stringify({ error: delErr.message }) };

    const { data: inserted, error } = await supa.from('decision_maker_personas').insert(rows).select('id');
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, inserted: (inserted || []).length }) };
  } catch (e: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};

