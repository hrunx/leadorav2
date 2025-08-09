import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Simple in-memory throttle/cache to reduce DB load and noisy logs during polling
// Cache responses for a very short TTL (e.g., 1500ms) per search_id
const cache = new Map<string, { ts: number; body: string }>();
const TTL_MS = 1500;

export const handler: Handler = async (event) => {
  try {
    const { search_id } = JSON.parse(event.body || '{}');
    if (!search_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'search_id required' }) };
    }

    // Throttle: return cached response if within TTL
    const now = Date.now();
    const cached = cache.get(search_id);
    if (cached && now - cached.ts < TTL_MS) {
      return { statusCode: 200, body: cached.body };
    }

    // Handle fallback/non-UUID search IDs (offline mode)
    if (!UUID_REGEX.test(search_id)) {
      return {
        statusCode: 200,
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

    // Get search progress
    const { data: search, error: searchError } = await supa
      .from('user_searches')
      .select('phase, progress_pct, status, error, updated_at')
      .eq('id', search_id)
      .single();

    // Handle case where search doesn't exist (fallback/offline search)
    if (searchError) {
      if (searchError.code === 'PGRST116') {
        // Search not found - return fallback response for offline/fallback searches
        return {
          statusCode: 200,
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
    const { data: logs } = await supa
      .from('api_usage_logs')
      .select('provider, endpoint, status, ms, created_at')
      .eq('search_id', search_id)
      .order('created_at', { ascending: false })
      .limit(10);

    // Get data counts (with error handling)
    const [businessPersonas, businesses, dmPersonas, dms, dmsPending, dmsDone, marketInsights] = await Promise.all([
      supa.from('business_personas').select('id').eq('search_id', search_id),
      supa.from('businesses').select('id').eq('search_id', search_id),
      supa.from('decision_maker_personas').select('id').eq('search_id', search_id),
      supa.from('decision_makers').select('id').eq('search_id', search_id),
      supa.from('decision_makers').select('id').eq('search_id', search_id).eq('enrichment_status', 'pending'),
      supa.from('decision_makers').select('id').eq('search_id', search_id).eq('enrichment_status', 'done'),
      supa.from('market_insights').select('id').eq('search_id', search_id)
    ]);

    const body = JSON.stringify({
        search_id,
        progress: search,
        data_counts: {
          business_personas: businessPersonas.data?.length || 0,
          businesses: businesses.data?.length || 0,
          dm_personas: dmPersonas.data?.length || 0,
          decision_makers: dms.data?.length || 0,
          decision_makers_pending: dmsPending.data?.length || 0,
          decision_makers_done: dmsDone.data?.length || 0,
          market_insights: marketInsights.data?.length || 0
        },
        recent_api_calls: logs
      });
    cache.set(search_id, { ts: Date.now(), body });
    return { statusCode: 200, body };
  } catch (error: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};