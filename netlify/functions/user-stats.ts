import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

function supaService() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const handler: Handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': event.headers.origin || '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, apikey, X-Requested-With', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  try {
    const user_id = String(event.queryStringParameters?.user_id || '').trim();
    if (!user_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'user_id required' }) };

    const client = supaService();

    // Count total searches for user
    const { count: total_searches } = await client
      .from('user_searches')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user_id);

    // Count qualified leads (any contact handle present: non-null)
    // Note: This counts non-null values; UI may further filter empty strings when listing
    const { count: qualified_leads } = await client
      .from('decision_makers')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user_id)
      .or('linkedin.not.is.null,email.not.is.null,phone.not.is.null');

    return { statusCode: 200, headers, body: JSON.stringify({ user_id, total_searches: total_searches || 0, qualified_leads: qualified_leads || 0 }) };
  } catch (e: any) {
    return { statusCode: 200, headers, body: JSON.stringify({ user_id: null, total_searches: 0, qualified_leads: 0, error: String(e?.message || e) }) };
  }
};


