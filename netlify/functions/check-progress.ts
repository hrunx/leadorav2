import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const handler: Handler = async (event) => {
  try {
    const { search_id } = JSON.parse(event.body || '{}');
    if (!search_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'search_id required' }) };
    }

    // Get search progress
    const { data: search, error: searchError } = await supa
      .from('user_searches')
      .select('phase, progress_pct, status, error, updated_at')
      .eq('id', search_id)
      .single();

    if (searchError) throw searchError;

    // Get recent API logs
    const { data: logs, error: logsError } = await supa
      .from('api_usage_logs')
      .select('provider, endpoint, status, ms, created_at')
      .eq('search_id', search_id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (logsError) throw logsError;

    // Get data counts
    const [businessPersonas, businesses, dmPersonas, dms, marketInsights] = await Promise.all([
      supa.from('business_personas').select('id').eq('search_id', search_id),
      supa.from('businesses').select('id').eq('search_id', search_id),
      supa.from('decision_maker_personas').select('id').eq('search_id', search_id),
      supa.from('decision_makers').select('id').eq('search_id', search_id),
      supa.from('market_insights').select('id').eq('search_id', search_id)
    ]);

    return {
      statusCode: 200,
      body: JSON.stringify({
        search_id,
        progress: search,
        data_counts: {
          business_personas: businessPersonas.data?.length || 0,
          businesses: businesses.data?.length || 0,
          dm_personas: dmPersonas.data?.length || 0,
          decision_makers: dms.data?.length || 0,
          market_insights: marketInsights.data?.length || 0
        },
        recent_api_calls: logs
      })
    };
  } catch (error: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};