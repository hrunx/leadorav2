import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

function supa() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const handler: Handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': event.headers.origin || '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  try {
    const search_id = (event.queryStringParameters?.search_id || '').trim();
    const client = supa();

    // Aggregated counts by status (compute client-side for compatibility)
    const { data: statusRows } = await client
      .from('jobs')
      .select('status')
      .order('created_at', { ascending: false })
      .limit(500);
    const counts = Array.isArray(statusRows)
      ? Object.entries(statusRows.reduce((acc: Record<string, number>, r: any) => {
          const s = String(r?.status || 'queued');
          acc[s] = (acc[s] || 0) + 1;
          return acc;
        }, {})).map(([status, count]) => ({ status, count }))
      : [];

    let jobs: any[] = [];
    if (search_id) {
      // Show recent jobs referencing this search_id in payload
      const { data } = await client
        .from('jobs')
        .select('*')
        .or(`payload->>search_id.eq.${search_id}`)
        .order('created_at', { ascending: false })
        .limit(50);
      jobs = data || [];
    } else {
      const { data } = await client
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(25);
      jobs = data || [];
    }

    // Light log to Netlify
    try { console.info('[check-jobs]', { search_id: search_id || null, status_counts: (counts || []).length, recent_count: jobs.length }); } catch {}
    return { statusCode: 200, headers, body: JSON.stringify({ counts: counts || [], recent: jobs }) };
  } catch (e: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
