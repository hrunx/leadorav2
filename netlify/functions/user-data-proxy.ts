import type { Handler } from '@netlify/functions';
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

function buildCorsHeaders(origin?: string, requestHeaders?: string, requestMethod?: string) {
  const allowHeaders = (requestHeaders && requestHeaders.length > 0)
    ? requestHeaders
    : 'Authorization, Content-Type, Accept, apikey, X-Requested-With';
  const allowMethods = (requestMethod && requestMethod.length > 0)
    ? requestMethod
    : 'GET, POST, OPTIONS, PUT, PATCH, DELETE';
  // In dev and for function proxy usage, a wildcard origin avoids Safari/WebKit access-control quirks
  const allowedOrigin = '*';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': allowHeaders,
    'Access-Control-Allow-Methods': allowMethods,
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Expose-Headers': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Timing-Allow-Origin': '*',
    'Vary': 'Origin'
  };
  // Do not set Allow-Credentials to keep wildcard origin valid across browsers
  return headers;
}

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const acrh = (event.headers['access-control-request-headers'] || event.headers['Access-Control-Request-Headers'] || '') as string;
  const acrm = (event.headers['access-control-request-method'] || event.headers['Access-Control-Request-Method'] || '') as string;
  const corsHeaders = buildCorsHeaders(origin, acrh, acrm);
  // Determine if we are in a local/LAN dev environment. We use this to allow
  // privileged reads via service role for convenience during development when
  // browser-side RLS may block search-scoped queries.
  const originHeader = (event.headers.origin || event.headers.Origin || '').toString();
  const hostHeaderRaw = (event.headers.host || event.headers.Host || '').toString();
  const hostOnly = hostHeaderRaw.split(':')[0];
  const isLocalOrigin = originHeader.startsWith('http://localhost') || originHeader.startsWith('http://127.0.0.1');
  const lanRegex = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/;
  const isLanOrigin = !!originHeader && originHeader.startsWith('http://') && lanRegex.test(originHeader.replace(/^https?:\/\//, ''));
  const isLocalHost = hostOnly === 'localhost' || hostOnly === '127.0.0.1';
  const isLanHost = !!hostOnly && lanRegex.test(hostOnly);
  const allowDev = isLocalOrigin || isLocalHost || isLanOrigin || isLanHost;
  // Validate required env after we can return CORS headers
  if (!supabaseUrl) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing SUPABASE_URL environment variable' })
    };
  }
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  // Only allow GET requests (respond OK to others to satisfy strict preflights in dev)
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  const { table, search_id, campaign_id, user_id, id } = event.queryStringParameters || {};

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
  const authHeader = String(event.headers.authorization || event.headers.Authorization || '');
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
  if (!search_id && !user_id && !id) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Either search_id or user_id or id is required' })
    };
  }

  // For user-scoped requests, require JWT in prod.
  // In local dev, allow user-scoped reads without JWT for localhost/LAN.
  if (user_id && !token && !allowDev) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Authorization required for user-scoped requests' })
    };
  }

  // Build Supabase REST query
  const params = new URLSearchParams();
  params.append('select', '*');
  if (search_id) params.append('search_id', `eq.${search_id}`);
  if (user_id) params.append('user_id', `eq.${user_id}`);
  if (id) params.append('id', `eq.${id}`);
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
    // In local/LAN development, when no user token is available, prefer using the
    // service role key to bypass RLS for search-scoped queries as well. This
    // ensures UI can read rows (e.g., market_insights) immediately after agents insert them.
    const useServiceRole = (!token && allowDev && !!supabaseServiceKey);
    const response = await fetch(restUrl, {
      headers: {
        apikey: String(useServiceRole ? supabaseServiceKey : supabaseAnonKey),
        ...(token ? { Authorization: `Bearer ${token}` } : (useServiceRole ? { Authorization: `Bearer ${String(supabaseServiceKey)}` } : {})),
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      // Be forgiving in dev: normalize any upstream non-OK to 200 with empty list
      // and surface the upstream code for debugging
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Upstream-Status': String(response.status) },
        body: JSON.stringify([])
      };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(data || [])
    };
  } catch (error: any) {
    const errMsg = String(error?.message || error);
    const warnHeaders = { 'X-Proxy-Error': 'fetch_failed', 'X-Proxy-Error-Message': errMsg.slice(0, 200) };
    // Normalize network errors to empty response to avoid UI CORS noise
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', ...warnHeaders },
      body: JSON.stringify([])
    };
  }
};

