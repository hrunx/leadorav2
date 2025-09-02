import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  try {
    const params = event.httpMethod === 'GET' ? (event.queryStringParameters || {}) : JSON.parse(event.body || '{}');
    const search_id = params.search_id as string;
    if (!search_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'search_id required' }) };
    const supa = createClient(URL, KEY, { auth: { persistSession: false } });

    const [bp, dmp, b, dm, mi] = await Promise.all([
      supa.from('business_personas').select('id, title, rank, match_score, demographics, characteristics, behaviors, market_potential, locations, embedding').eq('search_id', search_id).order('rank', { ascending: true }),
      supa.from('decision_maker_personas').select('id, title, rank, match_score, demographics, characteristics, behaviors, market_potential, embedding').eq('search_id', search_id).order('rank', { ascending: true }),
      supa.from('businesses').select('id, name, industry, country, city, match_score, persona_type').eq('search_id', search_id),
      supa.from('decision_makers').select('id, name, title, email, phone, linkedin, persona_id, company, location').eq('search_id', search_id),
      supa.from('market_insights').select('id, payload').eq('search_id', search_id)
    ]);

    const mapEmb = (rows: any[] | null) => (rows || []).map(r => ({ ...r, has_embedding: !!r.embedding, embedding: undefined }));
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        business_personas: mapEmb(bp.data || []),
        dm_personas: mapEmb(dmp.data || []),
        businesses: b.data || [],
        decision_makers: dm.data || [],
        market_insights: (mi.data || []).map((x: any) => ({ id: x.id, keys: Object.keys(x.payload || {}) }))
      }, null, 2)
    };
  } catch (e: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};


