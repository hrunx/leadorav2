import { createClient } from '@supabase/supabase-js';
import logger from '../lib/logger';
import pLimit from 'p-limit';
import { processBusinessForDM } from '../tools/instant-dm-discovery';
import { intelligentPersonaMapping, mapDecisionMakersToPersonas } from '../tools/persona-mapper';
import { embedText } from '../agents/clients';

function supa() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type JobRow = { id: string; type: string; payload: any };

export async function processJob(job: JobRow) {
  switch (job.type) {
    case 'dm_discovery_batch':
      return handleDMDiscoveryBatch(job.payload);
    case 'persona_mapping':
      return intelligentPersonaMapping(String(job.payload.search_id));
    case 'dm_persona_mapping':
      return mapDecisionMakersToPersonas(String(job.payload.search_id));
    case 'compute_bp_embeddings':
      return computeBPEmbeddings(job.payload.persona_ids as string[]);
    case 'compute_business_embeddings':
      return computeBusinessEmbeddings(job.payload.business_ids as string[]);
    case 'compute_dm_persona_embeddings':
      return computeDMPersonaEmbeddings(job.payload.persona_ids as string[]);
    case 'compute_dm_embeddings':
      return computeDMEmbeddings(job.payload.dm_ids as string[]);
    default:
      logger.warn('Unknown job type', { type: job.type });
  }
}

async function handleDMDiscoveryBatch(payload: { search_id: string; user_id: string; business_ids: string[]; country?: string; industry?: string; product_service?: string }) {
  const client = supa();
  const limit = pLimit(2);
  const { data } = await client
    .from('businesses')
    .select('*')
    .in('id', payload.business_ids);
  const businesses = (data || []) as any[];
  await Promise.allSettled(businesses.map(b => limit(() => processBusinessForDM(payload.search_id, payload.user_id, b, payload.product_service))));
  // Trigger enrichment for pending DMs in this search (best-effort)
  try {
    const base = process.env.URL || process.env.DEPLOY_URL || process.env.LOCAL_BASE_URL || 'http://localhost:8888';
    await fetch(`${base}/.netlify/functions/enrich-decision-makers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search_id: payload.search_id })
    });
  } catch {}
}

async function computeBPEmbeddings(personaIds: string[]) {
  const client = supa();
  const { data } = await client
    .from('business_personas')
    .select('id,title,demographics,characteristics,behaviors')
    .in('id', personaIds);
  const texts = (data || []).map((p: any) => [p.title, JSON.stringify(p.demographics||{}), JSON.stringify(p.characteristics||{}), JSON.stringify(p.behaviors||{})].join('\n'));
  if (!texts.length) return;
  const vectors = await embedText(texts);
  for (let i = 0; i < vectors.length; i++) {
    await client.rpc('set_business_persona_embedding', { persona_id: (data as any)[i].id, emb: vectors[i] });
  }
}

async function computeBusinessEmbeddings(ids: string[]) {
  const client = supa();
  const { data } = await client
    .from('businesses')
    .select('id,name,description,industry,country')
    .in('id', ids);
  const texts = (data || []).map((b: any) => [b.name, b.description, b.industry, b.country].join('\n'));
  if (!texts.length) return;
  const vectors = await embedText(texts);
  for (let i = 0; i < vectors.length; i++) {
    await client.rpc('set_business_embedding', { business_id: (data as any)[i].id, emb: vectors[i] });
  }
}

async function computeDMPersonaEmbeddings(personaIds: string[]) {
  const client = supa();
  const { data } = await client
    .from('decision_maker_personas')
    .select('id,title,demographics,characteristics,behaviors')
    .in('id', personaIds);
  const texts = (data || []).map((p: any) => [p.title, JSON.stringify(p.demographics||{}), JSON.stringify(p.characteristics||{}), JSON.stringify(p.behaviors||{})].join('\n'));
  if (!texts.length) return;
  const vectors = await embedText(texts);
  for (let i = 0; i < vectors.length; i++) {
    await client.rpc('set_dm_persona_embedding', { persona_id: (data as any)[i].id, emb: vectors[i] });
  }
}

async function computeDMEmbeddings(dmIds: string[]) {
  const client = supa();
  const { data } = await client
    .from('decision_makers')
    .select('id,name,title,department,level,company,location')
    .in('id', dmIds);
  const texts = (data || []).map((d: any) => [d.name, d.title, d.department, d.level, d.company, d.location].filter(Boolean).join('\n'));
  if (!texts.length) return;
  const vectors = await embedText(texts);
  for (let i = 0; i < vectors.length; i++) {
    await client.rpc('set_decision_maker_embedding', { dm_id: (data as any)[i].id, emb: vectors[i] });
  }
}
