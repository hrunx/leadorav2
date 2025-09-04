exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, apikey, X-Requested-With',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  try {
    const { search_id, user_id } = JSON.parse(event.body || '{}');
    if (!search_id || !user_id) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ ok:false, error:'search_id and user_id required' }) };
    }
    // Require UUID user_id to avoid anonymous runs
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(user_id))) {
      return { statusCode: 401, headers: cors, body: JSON.stringify({ ok:false, error:'auth_required' }) };
    }

    const base = process.env.URL || process.env.DEPLOY_URL || process.env.LOCAL_BASE_URL || 'http://localhost:8888';
    await fetch(`${base}/.netlify/functions/orchestrator-run-background`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ search_id, user_id })
    });

    return { statusCode: 202, headers: cors, body: JSON.stringify({ ok:true, message:'Accepted', search_id, user_id }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error: (e && e.message) || String(e) }) };
  }
};


