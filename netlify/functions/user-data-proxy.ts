import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!;
const backendApiUrl = process.env.BACKEND_API_URL!;

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

  const { table, search_id, campaign_id } = event.queryStringParameters || {};

  if (!table) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing table parameter' })
    };
  }

  // Validate caller identity
  const authHeader = event.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing authorization token' })
    };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  // Ensure search belongs to user if provided
  if (search_id) {
    const { data: search } = await supabase
      .from('user_searches')
      .select('id')
      .eq('id', search_id)
      .eq('user_id', user.id)
      .single();

    if (!search) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid search_id' })
      };
    }
  }

  const tableMap: Record<string, string> = {
    user_searches: 'user_searches',
    email_campaigns: 'email_campaigns',
    businesses: 'businesses',
    business_personas: 'business_personas',
    decision_maker_personas: 'decision_maker_personas',
    decision_makers: 'decision_makers',
    market_insights: 'market_insights',
    campaign_recipients: 'campaign_recipients',
    subscriptions: 'subscriptions',
    app_users: 'app_users'
  };

  const path = tableMap[table];

  if (!path) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid table parameter' })
    };
  }

  const params = new URLSearchParams();

  if (search_id) params.append('search_id', search_id);
  if (['user_searches', 'email_campaigns', 'subscriptions'].includes(table)) {
    params.append('user_id', user.id);
  }
  if (table === 'app_users') {
    params.append('id', user.id);
  }
  if (table === 'campaign_recipients') {
    if (!campaign_id) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing campaign_id parameter' })
      };
    }
    params.append('campaign_id', campaign_id);
  }

  try {
    const response = await fetch(`${backendApiUrl}/${path}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        statusCode: response.status,
        headers: corsHeaders,
        body: text
      };
    }

    const data = await response.json();
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

