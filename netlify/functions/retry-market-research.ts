import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

export const handler: Handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': event.headers.origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin'
  } as const;
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  try {
    const { search_id, user_id } = JSON.parse(event.body || '{}');
    if (!search_id || typeof search_id !== 'string') {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'search_id required' }) };
    }
    const url = process.env.VITE_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;
    const supa = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: search, error } = await supa
      .from('user_searches')
      .select('id, user_id, product_service, industries, countries, search_type')
      .eq('id', search_id)
      .single();
    if (error || !search) {
      return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'search_not_found' }) };
    }
    // Trigger background pipeline which includes market stage; return immediately
    const bgResp = await fetch(`${process.env.VITE_SITE_URL || 'http://localhost:8888'}/.netlify/functions/orchestrator-run-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search_id: search.id, user_id: user_id || search.user_id })
    });
    if (!bgResp.ok) {
      return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'background_trigger_failed' }) };
    }
    return { statusCode: 202, headers: cors, body: JSON.stringify({ accepted: true }) };
  } catch (e: any) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e?.message || 'retry_failed' }) };
  }
};

