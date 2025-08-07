import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Use service role for backend operations
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const { table, user_id, search_id } = event.queryStringParameters || {};

  if (!table) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing table parameter' })
    };
  }

  try {
    let query;
    switch (table) {
      case 'user_searches':
        if (!user_id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing user_id parameter' }) };
        query = supabase
          .from('user_searches')
          .select('*')
          .eq('user_id', user_id)
          .order('created_at', { ascending: false });
        break;
      case 'email_campaigns':
        if (!user_id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing user_id parameter' }) };
        query = supabase
          .from('email_campaigns')
          .select('*')
          .eq('user_id', user_id)
          .order('created_at', { ascending: false });
        break;
      case 'businesses':
        if (!search_id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing search_id parameter' }) };
        query = supabase
          .from('businesses')
          .select('*')
          .eq('search_id', search_id)
          .order('match_score', { ascending: false });
        break;
      case 'business_personas':
        if (!search_id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing search_id parameter' }) };
        query = supabase
          .from('business_personas')
          .select('*')
          .eq('search_id', search_id)
          .order('rank');
        break;
      case 'decision_maker_personas':
        if (!search_id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing search_id parameter' }) };
        query = supabase
          .from('decision_maker_personas')
          .select('*')
          .eq('search_id', search_id)
          .order('rank');
        break;
      case 'decision_makers':
        if (!search_id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing search_id parameter' }) };
        query = supabase
          .from('decision_makers')
          .select('*')
          .eq('search_id', search_id)
          .order('influence', { ascending: false });
        break;
      case 'market_insights':
        if (!search_id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing search_id parameter' }) };
        query = supabase
          .from('market_insights')
          .select('*')
          .eq('search_id', search_id);
        break;
      case 'campaign_recipients':
        if (!event.queryStringParameters?.campaign_id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing campaign_id parameter' }) };
        query = supabase
          .from('campaign_recipients')
          .select('*')
          .eq('campaign_id', event.queryStringParameters.campaign_id)
          .order('created_at');
        break;
      case 'subscriptions':
        if (!event.queryStringParameters?.user_id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing user_id parameter' }) };
        query = supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', event.queryStringParameters.user_id)
          .order('created_at', { ascending: false });
        break;
      case 'app_users':
        if (!event.queryStringParameters?.id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing id parameter' }) };
        query = supabase
          .from('app_users')
          .select('*')
          .eq('id', event.queryStringParameters.id);
        break;
      default:
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Invalid table parameter' })
        };
    }

    const { data, error } = await query;

    if (error) {
      console.error('Supabase error:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: error.message })
      };
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(data || [])
    };

  } catch (error: any) {
    console.error('Error fetching user data:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message })
    };
  }
};