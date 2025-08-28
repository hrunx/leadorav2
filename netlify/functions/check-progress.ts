import type { Handler } from '@netlify/functions';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

function getSupa(): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
const supa = getSupa();

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Simple in-memory throttle/cache to reduce DB load and noisy logs during polling
// Cache responses for a very short TTL (e.g., 1500ms) per search_id
const cache = new Map<string, { ts: number; body: string }>();
const TTL_MS = 1500;

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, apikey, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  try {
    // Support both POST (body) and GET (query param)
    const jsonBody = (() => { try { return JSON.parse(event.body || '{}'); } catch { return {}; } })() as any;
    const querySearchId = event.queryStringParameters?.search_id || '';
    const search_id = String(jsonBody?.search_id || querySearchId || '').trim();
    if (!search_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'search_id required' }) };
    }

    // Throttle: return cached response if within TTL
    const now = Date.now();
    const cached = cache.get(search_id);
    if (cached && now - cached.ts < TTL_MS) {
      return { statusCode: 200, headers: cors, body: cached.body };
    }

    // Handle fallback/non-UUID search IDs (offline mode)
    if (!UUID_REGEX.test(search_id)) {
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          search_id,
          progress: { phase: 'offline', progress_pct: 0, status: 'offline' },
          data_counts: {
            business_personas: 0,
            businesses: 0,
            dm_personas: 0,
            decision_makers: 0,
            market_insights: 0
          },
          recent_api_calls: []
        })
      };
    }

    // Get search progress (via Supabase if available, else via proxy)
    let search: any = null;
    let searchError: any = null;
    if (supa) {
      const { data, error } = await supa
        .from('user_searches')
        .select('phase, progress_pct, status, error, updated_at')
        .eq('id', search_id)
        .single();
      search = data; searchError = error;
    } else {
      try {
        const resp = await fetch(`${process.env.URL || 'http://localhost:8888'}/.netlify/functions/user-data-proxy?table=user_searches&search_id=${search_id}`, { headers: { Accept: 'application/json' } });
        if (resp.ok) {
          const arr = await resp.json();
          search = Array.isArray(arr) && arr.length ? arr[0] : null;
        }
      } catch {}
    }

    // Handle case where search doesn't exist (fallback/offline search)
    if (searchError) {
      if (searchError.code === 'PGRST116') {
        // Search not found - return fallback response for offline/fallback searches
        return {
          statusCode: 200,
          headers: cors,
          body: JSON.stringify({
            search_id,
            progress: { phase: 'offline', progress_pct: 0, status: 'offline' },
            data_counts: {
              business_personas: 0,
              businesses: 0,
              dm_personas: 0,
              decision_makers: 0,
              market_insights: 0
            },
            recent_api_calls: []
          })
        };
      }
      throw searchError;
    }

    // Get recent API logs (with error handling)
    let logs: any[] = [];
    if (supa) {
      const { data } = await supa
        .from('api_usage_logs')
        .select('provider, endpoint, status, ms, created_at')
        .eq('search_id', search_id)
        .order('created_at', { ascending: false })
        .limit(10);
      logs = data || [];
    }

    // Get data counts (with error handling)
    async function countViaProxy(table: string, extra: string = ''): Promise<number> {
      try {
        const u = `${process.env.URL || 'http://localhost:8888'}/.netlify/functions/user-data-proxy?table=${table}&search_id=${search_id}${extra}`;
        const r = await fetch(u, { headers: { Accept: 'application/json' } });
        if (r.ok) {
          const arr = await r.json();
          return Array.isArray(arr) ? arr.length : 0;
        }
      } catch {}
      return 0;
    }

    const [businessPersonasCount, businessesCount, dmPersonasCount, dmsCount, dmsPendingCount, dmsDoneCount, marketInsightsCount] = supa
      ? await Promise.all([
          supa.from('business_personas').select('id').eq('search_id', search_id),
          supa.from('businesses').select('id').eq('search_id', search_id),
          supa.from('decision_maker_personas').select('id').eq('search_id', search_id),
          supa.from('decision_makers').select('id').eq('search_id', search_id),
          // Consider both 'pending' and 'attempted' as not yet completed enrichment
          supa.from('decision_makers').select('id').eq('search_id', search_id).in('enrichment_status', ['pending','attempted']),
          // Consider 'done' and 'enriched' as completed enrichment
          supa.from('decision_makers').select('id').eq('search_id', search_id).in('enrichment_status', ['done','enriched']),
          supa.from('market_insights').select('id').eq('search_id', search_id)
        ]).then(([bp, biz, dmp, dm, dmpend, dmdone, mi]) => [
          bp.data?.length || 0,
          biz.data?.length || 0,
          dmp.data?.length || 0,
          dm.data?.length || 0,
          dmpend.data?.length || 0,
          dmdone.data?.length || 0,
          mi.data?.length || 0,
        ])
      : await Promise.all([
          countViaProxy('business_personas'),
          countViaProxy('businesses'),
          countViaProxy('decision_maker_personas'),
          countViaProxy('decision_makers'),
          countViaProxy('decision_makers', '&enrichment_status=eq.pending'),
          countViaProxy('decision_makers', '&enrichment_status=eq.done'),
          countViaProxy('market_insights'),
        ]);

    const body = JSON.stringify({
        search_id,
        progress: search,
        data_counts: {
          business_personas: businessPersonasCount,
          businesses: businessesCount,
          dm_personas: dmPersonasCount,
          decision_makers: dmsCount,
          decision_makers_pending: dmsPendingCount,
          decision_makers_done: dmsDoneCount,
          market_insights: marketInsightsCount
        },
        recent_api_calls: logs
      });
    cache.set(search_id, { ts: Date.now(), body });
    return { statusCode: 200, headers: cors, body };
  } catch (error: any) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: error.message })
    };
  }
};
