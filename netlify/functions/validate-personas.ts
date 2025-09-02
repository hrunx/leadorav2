import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { isRealisticPersona } from '../../src/tools/persona-validation';

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
    const { data: bp } = await supa.from('business_personas').select('id, title, rank, match_score, demographics, characteristics, behaviors, market_potential, locations').eq('search_id', search_id).order('rank', { ascending: true });
    const { data: dmp } = await supa.from('decision_maker_personas').select('id, title, rank, match_score, demographics, characteristics, behaviors, market_potential').eq('search_id', search_id).order('rank', { ascending: true });
    const results = {
      business_personas: (bp || []).map(p => ({ id: p.id, title: p.title, valid: isRealisticPersona('business', p as any) })),
      dm_personas: (dmp || []).map(p => ({ id: p.id, title: p.title, valid: isRealisticPersona('dm', p as any) }))
    };
    return { statusCode: 200, headers, body: JSON.stringify(results) };
  } catch (e: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};


