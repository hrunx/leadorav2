import type { Handler } from '@netlify/functions';
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

function buildCorsHeaders(origin?: string) {
  // Allow localhost and LAN IPs automatically in dev; otherwise reflect origin or fallback to *
  const isLocalhost = origin?.startsWith('http://localhost') || origin?.startsWith('http://127.0.0.1');
  const isLan = !!origin && /^(http:\/\/|https:\/\/)(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/i.test(origin);
  const isAllowed = allowedOrigins.length === 0 || (origin ? allowedOrigins.includes(origin) : false);
  const allowOrigin = origin || '*';
  const finalOrigin = (isLocalhost || isLan || isAllowed) ? allowOrigin : allowOrigin;
  return {
    'Access-Control-Allow-Origin': finalOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin'
  } as Record<string,string>;
}

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const corsHeaders = buildCorsHeaders(origin);
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

  // Auth model:
  // - For user-scoped queries (with user_id), require Bearer JWT
  // - For search-scoped queries (with search_id), allow anon; RLS must permit read by search_id
  // No service-role keys are used here.
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

  // Require at least one scope
  if (!search_id && !user_id) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Either search_id or user_id is required' })
    };
  }

  // For user-scoped requests, require JWT
  // In local dev, allow user-scoped reads without JWT for localhost to avoid CORS pain
  if (user_id && !token) {
    const originHeader = (event.headers.origin || event.headers.Origin || '').toString();
    const hostHeader = (event.headers.host || event.headers.Host || '').toString();
    const isLocalOrigin = originHeader.startsWith('http://localhost') || originHeader.startsWith('http://127.0.0.1');
    const isLocalHost = hostHeader.startsWith('localhost') || hostHeader.startsWith('127.0.0.1');
    const lanRegex = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/;
    const isLanOrigin = !!originHeader && originHeader.startsWith('http://') && lanRegex.test(originHeader.replace(/^https?:\/\//, ''));
    const isLanHost = !!hostHeader && lanRegex.test(hostHeader);
    const allowDev = isLocalOrigin || isLocalHost || isLanOrigin || isLanHost;
    if (!allowDev) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Authorization required for user-scoped requests' })
      };
    }
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
    // Query Supabase REST without service role; pass through anon and user token
    const restUrl = `${supabaseUrl}/rest/v1/${path}?${params.toString()}`;
    const response = await fetch(restUrl, {
      headers: {
        apikey: supabaseAnonKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

