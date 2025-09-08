import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import logger from '../../src/lib/logger';
import { harvestContactEmails } from '../../src/tools/email-harvesting';
import { updateDecisionMakerEnrichment, updateBusinessContacts } from '../../src/tools/db.write';

type Body = {
  contact_type: 'business' | 'dm';
  id: string;
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

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
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  const startedAt = Date.now();
  const softBudgetMs = Math.max(6000, Number(process.env.HARVEST_CONTACT_SOFT_BUDGET_MS || 8000));

  try {
    const body = JSON.parse(event.body || '{}') as Body;
    const id = String(body.id || '').trim();
    const type = body.contact_type;
    if (!id || (type !== 'business' && type !== 'dm')) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'contact_type and id required' }) };
    }

    if (type === 'dm') {
      const { data: dm, error } = await supa
        .from('decision_makers')
        .select('id,name,title,company,email,phone,search_id,user_id,business_id')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!dm) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'not_found' }) };

      let website: string | undefined = undefined;
      if (dm.business_id) {
        try {
          const { data: biz } = await supa
            .from('businesses')
            .select('website')
            .eq('id', dm.business_id)
            .maybeSingle();
          website = (biz as any)?.website || undefined;
        } catch {}
      }

      if (Date.now() - startedAt > softBudgetMs) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, id, contact_type: type, emails: [] }) };
      }

      const results = await harvestContactEmails(dm.name, dm.company, { title: dm.title, website });

      // Persist best
      if (results && results.length > 0) {
        const best = results[0];
        const update: any = {
          email: best.email,
          enrichment_status: (best.verification?.status === 'valid' || best.verification?.status === 'risky') ? 'enriched' : 'attempted',
          enrichment_confidence: Number(best.confidence || 0),
          enrichment_sources: [best.source || 'email_harvesting']
        };
        if (best.verification) update.email_verification = best.verification;
        try { await updateDecisionMakerEnrichment(dm.id, update); } catch (e: any) { logger.warn('update DM failed', { id: dm.id, error: e?.message || String(e) }); }
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...cors },
        body: JSON.stringify({ success: true, id, contact_type: type, emails: results || [] })
      };
    }

    // Business path
    const { data: biz, error } = await supa
      .from('businesses')
      .select('id,name,website,email,phone')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!biz) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'not_found' }) };

    if (Date.now() - startedAt > softBudgetMs) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, id, contact_type: type, emails: [] }) };
    }

    const results = await harvestContactEmails(biz.name, biz.name, { website: biz.website || undefined });
    if (results && results.length > 0) {
      const best = results[0];
      const updates: { email?: string; phone?: string; website?: string } = { email: best.email };
      try { await updateBusinessContacts(biz.id, updates); } catch (e: any) { logger.warn('update biz failed', { id: biz.id, error: e?.message || String(e) }); }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...cors },
      body: JSON.stringify({ success: true, id, contact_type: type, emails: results || [] })
    };
  } catch (error: any) {
    logger.error('campaign-harvest-contact error', { error: error?.message || String(error) });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error?.message || 'Internal error' }) };
  }
};


