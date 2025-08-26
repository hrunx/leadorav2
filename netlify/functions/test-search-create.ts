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
    const { user_id, product_service = 'CRM Software', industries = ['Technology'], countries = ['United States'], search_type = 'customer' } = JSON.parse(event.body || '{}');
    if (!user_id) return { statusCode: 400, headers: cors, body: JSON.stringify({ ok:false, error: 'user_id required' }) };

    const { data, error } = await supa
      .from('user_searches')
      .insert({ user_id, product_service, industries, countries, search_type, status: 'in_progress' })
      .select('id')
      .single();
    if (error) throw error;
    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok:true, search_id: data?.id }) };
  } catch (e:any) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error: e?.message || String(e) }) };
  }
};


