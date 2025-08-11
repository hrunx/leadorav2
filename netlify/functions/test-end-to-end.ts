import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export const handler: Handler = async (event) => {
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
    const body = event.body ? JSON.parse(event.body) : {};
    const product_service: string = body.product_service || 'AI-powered CRM software';
    const industries: string[] = body.industries || ['Technology'];
    const countries: string[] = body.countries || ['United States'];
    const user_id: string = body.user_id || '00000000-0000-0000-0000-000000000001';
    const timeoutSec: number = Math.max(30, Math.min(120, Number(body.timeout_sec || 60)));

    // 1) Create search
    const { data: search, error: errCreate } = await supa
      .from('user_searches')
      .insert({ user_id, search_type: 'customer', product_service, industries, countries, status: 'in_progress', phase: 'starting', progress_pct: 0 })
      .select('id,user_id')
      .single();
    if (errCreate) throw errCreate;

    // 2) Trigger orchestrator background
    const startUrl = `${process.env.URL || 'http://localhost:8888'}/.netlify/functions/orchestrator-start`;
    await fetch(startUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search_id: search.id, user_id: search.user_id })
    }).catch(()=>null);

    // 3) Poll DB for results until success or timeout
    const deadline = Date.now() + timeoutSec * 1000;
    let snapshot: any = null;
    while (Date.now() < deadline) {
      const [bp, dmp, biz, dm, mi, us, logs] = await Promise.all([
        supa.from('business_personas').select('id').eq('search_id', search.id),
        supa.from('decision_maker_personas').select('id').eq('search_id', search.id),
        supa.from('businesses').select('id').eq('search_id', search.id),
        supa.from('decision_makers').select('id').eq('search_id', search.id),
        supa.from('market_insights').select('id').eq('search_id', search.id),
        supa.from('user_searches').select('phase,progress_pct,status').eq('id', search.id).single(),
        supa.from('api_usage_logs').select('provider,status').eq('search_id', search.id)
      ]);

      snapshot = {
        counts: {
          business_personas: bp.data?.length || 0,
          dm_personas: dmp.data?.length || 0,
          businesses: biz.data?.length || 0,
          decision_makers: dm.data?.length || 0,
          market_insights: mi.data?.length || 0,
        },
        progress: us.data || { phase: 'unknown', progress_pct: 0, status: 'unknown' },
        api_usage: (logs.data || []).reduce((acc: any, row: any) => {
          const key = `${row.provider}:${row.status}`;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {})
      };

      const ok = snapshot.counts.business_personas >= 3 &&
                 snapshot.counts.dm_personas >= 3 &&
                 snapshot.counts.businesses >= 1 &&
                 snapshot.counts.decision_makers >= 1 &&
                 snapshot.counts.market_insights >= 1;
      if (ok) break;
      await sleep(2000);
    }

    // 4) Fetch sample records for verification
    const [bpS, dmpS, bizS, dmS, miS] = await Promise.all([
      supa.from('business_personas').select('id,title,rank').eq('search_id', search.id).order('rank').limit(3),
      supa.from('decision_maker_personas').select('id,title,rank').eq('search_id', search.id).order('rank').limit(3),
      supa.from('businesses').select('id,name,website,country,city').eq('search_id', search.id).limit(5),
      supa.from('decision_makers').select('id,name,title,company,linkedin').eq('search_id', search.id).limit(5),
      supa.from('market_insights').select('id,created_at').eq('search_id', search.id).limit(1)
    ]);

    const result = {
      ok: !!(snapshot && snapshot.counts),
      search_id: search.id,
      summary: snapshot,
      samples: {
        business_personas: bpS.data || [],
        dm_personas: dmpS.data || [],
        businesses: bizS.data || [],
        decision_makers: dmS.data || [],
        market_insights: miS.data || []
      }
    };

    return { statusCode: 200, headers: cors, body: JSON.stringify(result) };
  } catch (e: any) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error: e.message }) };
  }
};

