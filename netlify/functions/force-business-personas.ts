import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  try {
    const { search_id } = JSON.parse(event.body || '{}');
    if (!search_id) return { statusCode: 400, headers: cors, body: JSON.stringify({ ok:false, error:'search_id required' }) };
    const [{ loadSearch }] = await Promise.all([
      import('../../src/tools/db.read')
    ]);
    const search = await loadSearch(String(search_id));
    if (!search) return { statusCode: 404, headers: cors, body: JSON.stringify({ ok:false, error:'search_not_found' }) };

    const { generateBusinessPersonasFast } = await import('../../src/agents/fast-persona-generator');
    const inserted = await generateBusinessPersonasFast({
      id: String(search.id),
      user_id: String(search.user_id),
      product_service: String(search.product_service || ''),
      industries: Array.isArray(search.industries) ? search.industries : [],
      countries: Array.isArray(search.countries) ? search.countries : [],
      search_type: (search.search_type as 'customer'|'supplier') || 'customer'
    });

    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok:true, inserted: Array.isArray(inserted) ? inserted.length : 0 }) };
  } catch (e:any) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error: e?.message || String(e) }) };
  }
};
