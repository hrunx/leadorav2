import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { runBusinessPersonas } from '../../src/agents/business-persona.agent';

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  } as const;
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  try {
    const body = JSON.parse(event.body || '{}');
    const search_id: string | undefined = body.search_id;
    const user_id: string | undefined = body.user_id;
    const url = process.env.VITE_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;
    const supa = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

    // Load or create a minimal test search
    let search: any = null;
    if (search_id) {
      const { data } = await supa
        .from('user_searches')
        .select('id, user_id, product_service, industries, countries, search_type')
        .eq('id', search_id)
        .single();
      search = data;
    }
    if (!search) {
      const { data } = await supa
        .from('user_searches')
        .insert({
          user_id: user_id || '00000000-0000-0000-0000-000000000001',
          search_type: 'customer',
          product_service: 'CRM Software',
          industries: ['Technology'],
          countries: ['Saudi Arabia'],
          status: 'in_progress',
          phase: 'business_personas',
          progress_pct: 5
        })
        .select()
        .single();
      search = data;
    }

    // Run with a tight timeout guard to avoid Netlify 10–30s local timeouts
    const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race<T>([
      p,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout:runBusinessPersonas')), ms))
    ]);
    await withTimeout(runBusinessPersonas({
      id: String(search.id),
      user_id: String(search.user_id),
      product_service: String(search.product_service || ''),
      industries: Array.isArray(search.industries) ? search.industries : [],
      countries: Array.isArray(search.countries) ? search.countries : [],
      search_type: (search.search_type as 'customer' | 'supplier') || 'customer'
    }), 70000);

    const { data: rows } = await supa.from('business_personas').select('id,title,rank').eq('search_id', search.id);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, search_id: search.id, inserted: rows?.length || 0, rows })
    };
  } catch (e: any) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: e?.message || String(e) }) };
  }
};

