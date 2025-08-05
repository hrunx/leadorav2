import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  try {
    const { search_id, user_id } = JSON.parse(event.body || '{}');
    if (!search_id || !user_id) {
      return { statusCode: 400, body: JSON.stringify({ ok:false, error:'search_id and user_id required' }) };
    }

    // Call the background runner (same path but -background)
    // Netlify invokes it async and returns 202 immediately.
    await fetch(`${process.env.URL}/.netlify/functions/orchestrator-run-background`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ search_id, user_id })
    });

    return { statusCode: 202, body: JSON.stringify({ ok:true, message:'Accepted', search_id, user_id }) };
  } catch (e:any) {
    return { statusCode: 500, body: JSON.stringify({ ok:false, error:e.message }) };
  }
};