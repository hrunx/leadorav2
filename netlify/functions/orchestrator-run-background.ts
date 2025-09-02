import { Handler } from '@netlify/functions';
import logger from '../../src/lib/logger';
import { supaServer } from '../../src/lib/supaServer';
import { runPersonas } from '../../src/stages/01-personas';
import { runDiscovery } from '../../src/stages/02-discovery';
import { runDMEnrichment } from '../../src/stages/03-dm-enrichment';
import { runMarket } from '../../src/stages/04-market';

const supa = supaServer();
const supaAny = supa as any;

async function ensureTask(job_id: string, name: string) {
  await supaAny.from('job_tasks').upsert({ job_id, name, idempotency_key: `${job_id}:${name}` }, { onConflict: 'job_id,name' });
}
async function startTask(name: string, job_id: string) {
  // attempt increment via RPC or raw SQL is not available; do simple update
  const { data } = await supaAny.from('job_tasks').select('attempt').eq('job_id', job_id).eq('name', name).maybeSingle();
  const attempt = (data && typeof (data as any).attempt === 'number') ? (data as any).attempt + 1 : 1;
  await supaAny.from('job_tasks').update({ status: 'running', progress: 0, started_at: new Date().toISOString(), attempt }).eq('job_id', job_id).eq('name', name);
}
async function completeTask(name: string, job_id: string) {
  await supaAny.from('job_tasks').update({ status: 'succeeded', progress: 100, finished_at: new Date().toISOString() }).eq('job_id', job_id).eq('name', name);
}
async function markFailed(job_id: string, error: string) {
  await supaAny.from('job_tasks').update({ status: 'failed', error }).eq('job_id', job_id).neq('status', 'succeeded');
  await supaAny.from('jobs').update({ status: 'failed' }).eq('id', job_id);
}
async function upsertJob(search_id: string, user_id: string) {
  const { data: existing } = await supaAny
    .from('jobs')
    .select('id,status')
    .eq('payload->>search_id', search_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing && (existing as any).id) {
    await supaAny.from('jobs').update({ status: 'running' }).eq('id', (existing as any).id);
    return (existing as any).id as string;
  }
  const { data: created } = await supaAny
    .from('jobs')
    .insert({ type: 'sequential_pipeline', payload: { search_id, user_id }, status: 'running' })
    .select('id')
    .single();
  return (created as any).id as string;
}
async function loadInputs(search_id: string) {
  const { data } = await supaAny
    .from('user_searches')
    .select('id,user_id,search_type,industries,countries,product_service')
    .eq('id', search_id)
    .single();
  if (!data) throw new Error('search_not_found');
  const seg = ((data as any).search_type === 'supplier') ? 'suppliers' : 'customers';
  const industries = Array.isArray((data as any).industries) ? (data as any).industries as string[] : [];
  const countries = Array.isArray((data as any).countries) ? (data as any).countries as string[] : [];
  const query = String((data as any).product_service || '');
  return { segment: seg as 'customers'|'suppliers', industries, countries, query, user_id: String((data as any).user_id) };
}

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
    const { search_id, user_id } = JSON.parse(event.body || '{}');
    if (!search_id || !user_id) return { statusCode: 400, headers: cors, body: 'search_id and user_id required' };
    logger.info('Starting sequential pipeline', { search_id, user_id });

    // create or resume job and tasks
    const job_id = await upsertJob(search_id, user_id);
    await ensureTask(job_id, 'personas');
    await ensureTask(job_id, 'discovery');
    await ensureTask(job_id, 'dm_enrichment');
    await ensureTask(job_id, 'market_research');

    const inputs = await loadInputs(search_id);
    logger.info('Loaded inputs', { search_id, segment: inputs.segment, industries: inputs.industries, countries: inputs.countries, query: inputs.query });

    try {
      // Kick off market research immediately in parallel so insights are ready early
      await startTask('market_research', job_id);
      logger.info('Running market_research stage (parallel)', { search_id });
      const marketPromise = runMarket({
        search_id,
        user_id: inputs.user_id,
        segment: inputs.segment,
        industries: inputs.industries,
        countries: inputs.countries,
        query: inputs.query
      })
        .then(async () => {
          await completeTask('market_research', job_id);
          logger.info('Market research stage completed', { search_id });
        })
        .catch(async (e) => {
          logger.error('Market research failed', { error: (e as any)?.message || e });
          await supaAny.from('job_tasks').update({ status: 'failed', error: String((e as any)?.message || e) }).eq('job_id', job_id).eq('name', 'market_research');
        });

      // Personas first to seed roles and mapping logic
      await startTask('personas', job_id);
      logger.info('Running personas stage', { search_id });
      await runPersonas({ ...inputs, search_id });
      await completeTask('personas', job_id);
      logger.info('Personas stage completed', { search_id });

      // Discovery followed by DM discovery/enrichment
      await startTask('discovery', job_id);
      logger.info('Running discovery stage', { search_id });
      await runDiscovery({ search_id, user_id: inputs.user_id, industries: inputs.industries, countries: inputs.countries, query: inputs.query });
      await completeTask('discovery', job_id);
      logger.info('Discovery stage completed', { search_id });

      await startTask('dm_enrichment', job_id);
      logger.info('Running dm_enrichment stage', { search_id });
      await runDMEnrichment({ search_id, user_id: inputs.user_id });
      await completeTask('dm_enrichment', job_id);
      logger.info('DM enrichment stage completed', { search_id });

      // Wait for market research if still running
      await marketPromise;

      await supaAny.from('jobs').update({ status: 'done' }).eq('id', job_id);
      await supaAny.from('user_searches').update({ phase: 'completed', status: 'completed', progress_pct: 100, updated_at: new Date().toISOString() }).eq('id', search_id);
      logger.info('Sequential pipeline completed', { search_id });
      return { statusCode: 202, headers: cors, body: 'accepted' };
    } catch (e: any) {
      await markFailed(job_id, String(e?.message || e));
      await supaAny.from('user_searches').update({ phase: 'failed', status: 'failed', progress_pct: 0, error: { message: String(e?.message || e) }, updated_at: new Date().toISOString() }).eq('id', search_id);
      throw e;
    }
  } catch (e:any) {
    logger.error('Sequential pipeline failed', { error: e?.message || e });
    return { statusCode: 202, headers: cors, body: 'accepted' };
  } finally {
    // no-op
  }
};
