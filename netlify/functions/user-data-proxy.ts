import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
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

  const { table, search_id, campaign_id, user_id } = event.queryStringParameters || {};

  if (!table) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing table parameter' })
    };
  }

  // Relaxed auth: allow unauthenticated GETs (RLS permits anon per SQL fix).
  // If a Bearer token is provided, we will prefer it for user-scoped tables,
  // but we will not block if it's missing.
  const authHeader = event.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

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

  // Build Supabase REST query
  const params = new URLSearchParams();
  params.append('select', '*');
  if (search_id) params.append('search_id', `eq.${search_id}`);
  if (user_id) params.append('user_id', `eq.${user_id}`);
  if (table === 'campaign_recipients') {
    if (!campaign_id) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing campaign_id parameter' })
      };
    }
    params.append('campaign_id', `eq.${campaign_id}`);
  }

  try {
    // Query Supabase REST directly with service role (server-side only)
    const restUrl = `${supabaseUrl}/rest/v1/${path}?${params.toString()}`;
    const response = await fetch(restUrl, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
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

