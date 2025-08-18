import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { runBusinessPersonas } from '../../src/agents/business-persona.agent';

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
    const { search_id } = JSON.parse(event.body || '{}');
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
    // First, clear existing persona mappings to ensure clean remapping
    await supa
      .from('businesses')
      .update({ persona_id: null, persona_type: 'business_candidate' })
      .eq('search_id', search_id);
      
    // Delete existing personas before regenerating
    await supa
      .from('business_personas')
      .delete()
      .eq('search_id', search_id);
      
    // Regenerate personas
    await runBusinessPersonas({
      id: String(search.id),
      user_id: String(search.user_id),
      product_service: String(search.product_service || ''),
      industries: Array.isArray(search.industries) ? search.industries : [],
      countries: Array.isArray(search.countries) ? search.countries : [],
      search_type: (search.search_type as 'customer' | 'supplier') || 'customer'
    });
    
    // Trigger business-persona remapping after regeneration
    try {
      const { intelligentPersonaMapping } = await import('../../src/tools/persona-mapper');
      await intelligentPersonaMapping(search_id);
    } catch (error: any) {
      console.warn('Failed to remap businesses to new personas:', error?.message || error);
    }
    
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
  } catch (e: any) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e?.message || 'retry_failed' }) };
  }
};


