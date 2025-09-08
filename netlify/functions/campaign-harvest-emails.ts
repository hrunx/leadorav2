import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import logger from '../../src/lib/logger';
import { harvestContactEmails } from '../../src/tools/email-harvesting';
import { updateDecisionMakerEnrichment, updateBusinessContacts } from '../../src/tools/db.write';

type HarvestRequestBody = {
  user_id?: string;
  search_id?: string;
  business_ids?: string[];
  dm_ids?: string[];
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

  try {
    const startedAt = Date.now();
    const softBudgetMs = Math.max(15000, Number(process.env.HARVEST_SOFT_BUDGET_MS || 20000));
    const body = JSON.parse(event.body || '{}') as HarvestRequestBody;
    const businessIds = Array.isArray(body.business_ids) ? body.business_ids.filter(Boolean) : [];
    const dmIds = Array.isArray(body.dm_ids) ? body.dm_ids.filter(Boolean) : [];

    if (businessIds.length === 0 && dmIds.length === 0) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Provide business_ids or dm_ids' }) };
    }

    // Load targets in bulk
    const [bizQ, dmQ] = await Promise.all([
      businessIds.length
        ? supa.from('businesses').select('id,name,website,email,phone').in('id', businessIds)
        : Promise.resolve({ data: [], error: null } as any),
      dmIds.length
        ? supa.from('decision_makers').select('id,name,title,company,email,phone,search_id,user_id,linkedin').in('id', dmIds)
        : Promise.resolve({ data: [], error: null } as any)
    ]);

    if (bizQ.error) throw bizQ.error;
    if (dmQ.error) throw dmQ.error;

    const businesses = (bizQ.data || []) as Array<{ id: string; name: string; website?: string | null; email?: string | null; phone?: string | null }>;
    const dms = (dmQ.data || []) as Array<{ id: string; name: string; title: string; company: string; email?: string | null; phone?: string | null; search_id: string; user_id: string; linkedin?: string | null }>;

    const harvested: Record<string, Array<{ email: string; confidence?: number; source?: string; verification?: { status?: string; score?: number } }>> = {};
    let emailsFound = 0;
    let updatedCount = 0;

    // Process limit per invocation to avoid Netlify timeouts
    const maxItems = Math.max(1, Number(process.env.CAMPAIGN_HARVEST_MAX_ITEMS || 12));
    const dmTargets = dms.slice(0, maxItems);
    const bizTargets = businesses.slice(0, Math.max(0, maxItems - dmTargets.length));

    // Simple concurrency limiter
    const limit = Math.max(1, Number(process.env.CAMPAIGN_HARVEST_CONCURRENCY || 4));
    async function runLimited<T>(items: T[], worker: (item: T) => Promise<void>) {
      let idx = 0;
      const runners: Promise<void>[] = [];
      for (let i = 0; i < Math.min(limit, items.length); i++) {
        runners.push((async function run() {
          while (idx < items.length) {
            const cur = items[idx++];
            try { await worker(cur); } catch (e: any) { /* logged in worker */ }
          }
        })());
      }
      await Promise.all(runners);
    }

    // Process decision makers with limited concurrency
    await runLimited(dmTargets, async (dm) => {
      if (Date.now() - startedAt > softBudgetMs) return; // stop to avoid timeout
      try {
        const results = await harvestContactEmails(dm.name, dm.company, { title: dm.title });
        const emails = Array.isArray(results) ? results : [];
        if (emails.length > 0) {
          harvested[dm.id] = emails.map(e => ({ email: e.email, confidence: e.confidence, source: e.source, verification: { status: e.verification?.status, score: e.verification?.score } }));
          emailsFound += emails.length;
          const best = emails[0];
          if (best?.email) {
            const update: any = {
              email: best.email,
              enrichment_status: (best.verification?.status === 'valid' || best.verification?.status === 'risky') ? 'enriched' : 'attempted',
              enrichment_confidence: Number(best.confidence || 0),
              enrichment_sources: ['email_harvesting']
            };
            if (best.verification) update.email_verification = best.verification;
            await updateDecisionMakerEnrichment(dm.id, update);
            updatedCount++;
          }
        }
      } catch (e: any) {
        logger.warn('DM harvest failed', { id: dm.id, error: e?.message || String(e) });
      }
    });

    // Process businesses with limited concurrency
    await runLimited(bizTargets, async (biz) => {
      if (Date.now() - startedAt > softBudgetMs) return; // stop to avoid timeout
      try {
        const results = await harvestContactEmails(biz.name, biz.name, { website: biz.website || undefined });
        const emails = Array.isArray(results) ? results : [];
        if (emails.length > 0) {
          harvested[biz.id] = emails.map(e => ({ email: e.email, confidence: e.confidence, source: e.source, verification: { status: e.verification?.status, score: e.verification?.score } }));
          emailsFound += emails.length;
          const best = emails[0];
          if (best?.email) {
            const updates: { email?: string; phone?: string; website?: string } = { email: best.email };
            await updateBusinessContacts(biz.id, updates);
            updatedCount++;
          }
        }
      } catch (e: any) {
        logger.warn('Business harvest failed', { id: biz.id, error: e?.message || String(e) });
      }
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...cors },
      body: JSON.stringify({ success: true, processed: dmTargets.length + bizTargets.length, totalRequested: dmIds.length + businessIds.length, emailsFound, updated: updatedCount, harvested })
    };
  } catch (error: any) {
    logger.error('campaign-harvest-emails error', { error: error?.message || String(error) });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error?.message || 'Internal error' }) };
  }
};


