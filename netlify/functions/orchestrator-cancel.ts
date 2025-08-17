import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, apikey, X-Requested-With',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  } as const;
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  try {
    const { search_id } = JSON.parse(event.body || '{}');
    if (!search_id) return { statusCode: 400, headers: cors, body: JSON.stringify({ ok:false, error:'search_id required' }) };
    const supa = createClient(URL, KEY, { auth: { persistSession: false } });
    const { error } = await supa
      .from('user_searches')
      .update({ phase: 'cancelled', status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', search_id);
    if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error: error.message }) };
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok:true }) };
  } catch (e:any) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error: e?.message || 'cancel_failed' }) };
  }
};


