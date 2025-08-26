import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  } as const;
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  try {
    const { search_id, user_id } = JSON.parse(event.body || '{}');
    if (!search_id || !user_id) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'search_id and user_id required' }) };
    const { execBusinessPersonas } = await import('../../src/orchestration/exec-business-personas');
    await execBusinessPersonas({ search_id: String(search_id), user_id: String(user_id) });
    // Post-check count to surface result
    try {
      const { loadBusinessPersonas } = await import('../../src/tools/db.read');
      const rows = await loadBusinessPersonas(String(search_id));
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, inserted: Array.isArray(rows) ? rows.length : 0 }) };
    } catch {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }
  } catch (e: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e?.message || String(e) }) };
  }
};


