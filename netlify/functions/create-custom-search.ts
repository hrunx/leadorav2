import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, apikey, X-Requested-With',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  } as const;
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'method_not_allowed' }) };
  try {
    const body = JSON.parse(event.body || '{}');
    const product_service = String(body.product_service || `Test ${Date.now()}`);
    const industries = Array.isArray(body.industries) ? body.industries.map(String) : ['Technology'];
    const countries = Array.isArray(body.countries) ? body.countries.map(String) : ['United States'];
    const search_type = (body.search_type === 'supplier' ? 'supplier' : 'customer') as 'customer' | 'supplier';

    const supa = createClient(
      process.env.VITE_SUPABASE_URL!,
      (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY)!
    );
    // Reuse an existing user_id for convenience
    let user_id = '00000000-0000-0000-0000-000000000001';
    const { data: existing } = await supa.from('user_searches').select('user_id').limit(1);
    if (existing && existing.length > 0 && existing[0].user_id) user_id = existing[0].user_id;

    const { data: search, error } = await supa
      .from('user_searches')
      .insert({ user_id, search_type, product_service, industries, countries, status: 'in_progress', phase: 'business_personas', progress_pct: 5 })
      .select()
      .single();
    if (error) throw error;
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, search_id: search.id, user_id: search.user_id }) };
  } catch (e: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e?.message || String(e) }) };
  }
};


