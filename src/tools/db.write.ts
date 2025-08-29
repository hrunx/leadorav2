import { createClient } from '@supabase/supabase-js';
import logger from '../lib/logger';
import { randomUUID } from 'crypto';
import { MarketInsightsInsertSchema } from '../lib/marketInsightsSchema';

// Create a memoized client for Netlify functions/server usage only
let _supaWrite: any = null;
const getSupabaseClient = () => {
  if (typeof window !== 'undefined') {
    throw new Error('db.write.ts must not be imported/used in the browser');
  }
  if (_supaWrite) return _supaWrite;
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL) throw new Error('supabaseUrl is required. Set SUPABASE_URL or VITE_SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('supabaseKey is required. Set SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_SERVICE_ROLE_KEY');
  _supaWrite = createClient<any>(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
  return _supaWrite;
};

// --- Totals helpers ---
async function countBySearch(table: string, search_id: string): Promise<number> {
  const supa = getSupabaseClient();
  const { count, error } = await supa
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('search_id', search_id);
  if (error) throw error;
  return count || 0;
}

export async function updateSearchTotals(search_id: string): Promise<void> {
  const supa = getSupabaseClient();
  const [businessPersonas, dmPersonas, businesses, decisionMakers, marketInsights] = await Promise.all([
    countBySearch('business_personas', search_id),
    countBySearch('decision_maker_personas', search_id),
    countBySearch('businesses', search_id),
    countBySearch('decision_makers', search_id),
    countBySearch('market_insights', search_id),
  ]);

  const totals = {
    business_personas: businessPersonas,
    dm_personas: dmPersonas,
    businesses,
    decision_makers: decisionMakers,
    market_insights: marketInsights,
  } as const;

  const { error } = await supa
    .from('user_searches')
    .update({ totals, updated_at: new Date().toISOString() })
    .eq('id', search_id);
  if (error) throw error;
}

export const insertBusinessPersonas = async (rows: any[]) => {
  const supa = getSupabaseClient();
  const { data, error } = await supa.from('business_personas').insert(rows).select('*');
  if (error) throw error;
  const search_id = rows?.[0]?.search_id as string | undefined;
  if (search_id) {
    try { await updateSearchTotals(search_id); } catch (e: any) { logger.warn('updateSearchTotals failed', { error: e?.message || e }); }
    // Enqueue persona mapping and embeddings
    try {
      const { enqueueJob } = await import('./jobs');
      await enqueueJob('persona_mapping', { search_id });
      const persona_ids = (data || []).map((d: any) => d.id);
      if (persona_ids.length) await enqueueJob('compute_bp_embeddings', { persona_ids });
    } catch (e: any) { logger.warn('enqueue jobs failed (business_personas)', { error: e?.message || e }); }
  }
  return data!;
};

export const insertPersonaCache = async (cache_key: string, personas: any[]) => {
  const supa = getSupabaseClient();
  try {
    const { error } = await supa
      .from('persona_cache')
      .upsert({ cache_key, personas })
      .select('cache_key');
    if (error) throw error;
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if ((e && (e.code === '42P01')) || /does not exist/i.test(msg)) {
      // persona_cache table not present; treat as optional cache and continue silently
      logger.warn('persona_cache table missing; skipping cache write', { cache_key });
      return;
    }
    throw e;
  }
};

// Patch insertBusinesses to guarantee returned objects always include country and industry
// Add a type/interface for the business row for type safety
// If Supabase omits these fields, explicitly add them from the input rows before returning
// Stronger typing for business insert and return rows
type BusinessInsertRow = {
  search_id: string;
  user_id: string;
  name: string;
  industry: string;
  country: string;
  address?: string;
  city?: string;
  phone?: string;
  website?: string;
  rating?: number | null;
  size?: string;
  revenue?: string;
  description?: string;
  match_score?: number;
  persona_id?: string | null;
  persona_type?: string;
  relevant_departments?: string[];
  key_products?: string[];
  recent_activity?: string[];
};

export const insertBusinesses = async (rows: BusinessInsertRow[]) => {
  const supa = getSupabaseClient();
  const { data, error } = await supa.from('businesses').insert(rows).select('*');
  if (error) throw error; 
  const search_id = rows?.[0]?.search_id as string | undefined;
  if (search_id) {
    try { await updateSearchTotals(search_id); } catch (e: any) { logger.warn('updateSearchTotals failed', { error: e?.message || e }); }
    // Enqueue persona mapping + embeddings compute for businesses
    try {
      const { enqueueJob } = await import('./jobs');
      await enqueueJob('persona_mapping', { search_id });
      const business_ids = (data || []).map((d: any) => d.id);
      if (business_ids.length) await enqueueJob('compute_business_embeddings', { business_ids });
    } catch (e: any) { logger.warn('enqueue jobs failed (businesses)', { error: e?.message || e }); }
  }
  // Ensure returned objects include mandatory fields promised by callers
  const ensured = (data || []).map((ret: any, idx: number) => {
    const src = (rows[idx] || rows[0]) as BusinessInsertRow;
    return {
      ...(ret as Record<string, unknown>),
      country: (ret as any).country ?? src.country,
      industry: (ret as any).industry ?? src.industry,
    } as any;
  });
  return ensured as any;
};

export const insertDMPersonas = async (rows: any[]) => {
  const supa = getSupabaseClient();
  const { data, error } = await supa.from('decision_maker_personas').insert(rows).select('id,title,rank');
  if (error) throw error; 
  const search_id = rows?.[0]?.search_id as string | undefined;
  if (search_id) {
    try { await updateSearchTotals(search_id); } catch (e: any) { logger.warn('updateSearchTotals failed', { error: e?.message || e }); }
    try {
      const { enqueueJob } = await import('./jobs');
      await enqueueJob('dm_persona_mapping', { search_id });
      const persona_ids = (data || []).map((d: any) => d.id);
      if (persona_ids.length) await enqueueJob('compute_dm_persona_embeddings', { persona_ids });
    } catch (e: any) { logger.warn('enqueue jobs failed (dm_personas)', { error: e?.message || e }); }
  }
  return data!;
};

// Insert basic DM data with enrichment_status = 'pending'
export const insertDecisionMakersBasic = async (rows: any[]) => {
  const basicRows = rows.map(row => ({
    ...row,
    // Ensure id is present to avoid NOT NULL constraint violations on some schemas
    id: row.id || randomUUID(),
    linkedin: String(row.linkedin || ''),
    enrichment_status: 'pending' as const,
    enrichment: row.enrichment ?? null
  }));
  
  const supa = getSupabaseClient();
  // Use upsert to avoid unique constraint errors on (search_id, linkedin)
  const { data, error } = await supa
    .from('decision_makers')
    .upsert(basicRows, { onConflict: 'search_id,linkedin', ignoreDuplicates: true })
    .select('id,name,company,title,linkedin');
  if (error) throw error; 
  const search_id = basicRows?.[0]?.search_id as string | undefined;
  if (search_id) {
    try { await updateSearchTotals(search_id); } catch (e: any) { logger.warn('updateSearchTotals failed', { error: e?.message || e }); }
    // Enqueue embeddings + DM persona mapping
    try {
      const { enqueueJob } = await import('./jobs');
      const dm_ids = (data || []).map((d: any) => d.id);
      if (dm_ids.length) await enqueueJob('compute_dm_embeddings', { dm_ids });
      await enqueueJob('dm_persona_mapping', { search_id });
    } catch (e: any) { logger.warn('enqueue jobs failed (decision_makers)', { error: e?.message || e }); }
  }
  return data!;
};

// Update enrichment data for a specific decision maker - moved to end of file

type InsightSource = {
  title?: string;
  url: string;
  date?: string;
  [key: string]: any;
};

export const insertMarketInsights = async (row: {
  search_id: string;
  user_id: string;
  tam_data: any;
  sam_data: any;
  som_data: any;
  competitor_data: any[];
  trends: any[];
  opportunities: any;
  sources?: InsightSource[];
  analysis_summary?: string;
  research_methodology?: string;
}) => {
  const parsed = MarketInsightsInsertSchema.safeParse(row);
  if (!parsed.success) {
    logger.error('Invalid market insights payload', { error: parsed.error });
    throw new Error('Invalid market insights payload');
  }
  const supa = getSupabaseClient();

  const sources = (parsed.data.sources || []).map((s: any) => {
    if (typeof s === 'string') return { title: s, url: s } as InsightSource;
    return { title: s.title ?? s.url, url: s.url, date: s.date, ...s } as InsightSource;
  });
  const { data, error } = await supa.from('market_insights').insert({ ...parsed.data, sources }).select('id').single();
  if (error) throw error;
  try { await updateSearchTotals(row.search_id); } catch (e: any) { logger.warn('updateSearchTotals failed', { error: e?.message || e }); }
  return data!;
};

export async function mergeAgentMetadata(search_id: string, metadata: Record<string, any>): Promise<void> {
  const supa = getSupabaseClient();
  const { data, error } = await supa
    .from('user_searches')
    .select('agent_metadata')
    .eq('id', search_id)
    .single();
  if (error) throw error;
  const current = data?.agent_metadata || {};
  const merged = { ...current, ...metadata };
  const { error: updateError } = await supa
    .from('user_searches')
    .update({ agent_metadata: merged, updated_at: new Date().toISOString() })
    .eq('id', search_id);
  if (updateError) throw updateError;
}

// Append a lightweight event record to agent_metadata.last_events (kept to last 10)
export async function appendAgentEvent(search_id: string, event: string, extra?: Record<string, any>): Promise<void> {
  try {
    const supa = getSupabaseClient();
    const { data } = await supa
      .from('user_searches')
      .select('agent_metadata')
      .eq('id', search_id)
      .single();
    const meta = (data as any)?.agent_metadata || {};
    const list: any[] = Array.isArray(meta?.last_events) ? meta.last_events : [];
    const entry = { t: Date.now(), e: event, ...(extra || {}) };
    const next = [...list, entry].slice(-10);
    const merged = { ...meta, last_events: next };
    await supa
      .from('user_searches')
      .update({ agent_metadata: merged, updated_at: new Date().toISOString() })
      .eq('id', search_id);
  } catch (e:any) {
    logger.warn('appendAgentEvent failed', { error: e?.message || e });
  }
}

// enforce allowed phases (must match DB CHECK constraint on user_searches.phase)
const AllowedPhasesList = [
  'starting',
  'business_discovery',
  'business_personas',
  'dm_personas',
  'decision_makers',
  'market_research',
  'completed',
  'failed',
] as const;
type Phase = typeof AllowedPhasesList[number];
const AllowedPhases = new Set<string>(AllowedPhasesList as unknown as string[]);

// Normalize old labels used in code
function normalizePhase(p: string): Phase {
  switch (p) {
    case 'created': return 'starting';
    case 'in_progress': return 'starting';
    case 'initializing': return 'starting';
    case 'parallel_processing': return 'business_discovery';
    case 'starting_discovery': return 'business_discovery';
    case 'businesses': return 'business_discovery';
    case 'business_discovery_completed': return 'business_discovery';
    case 'personas': return 'business_personas';
    case 'business_personas_completed': return 'business_personas';
    case 'dm_personas_completed': return 'dm_personas';
    case 'market_insights': return 'market_research';
    default:
      return (AllowedPhases.has(p) ? (p as Phase) : 'starting');
  }
}

export async function updateSearchProgress(
  search_id: string,
  progress_pct: number,
  phase: string,
  status = 'in_progress',
  status_detail?: Record<string, 'done' | 'failed'>
) {
  const normPhase = normalizePhase(phase);
  const supa = getSupabaseClient();
  // Monotonic progress: never decrease percentage; do not regress phase order
  const { data: current } = await supa
    .from('user_searches')
    .select('progress_pct, phase')
    .eq('id', search_id)
    .single();
  let nextPct = progress_pct;
  let nextPhase = normPhase;
  if (current) {
    const currentProgress = typeof (current as any).progress_pct === 'number' ? Number((current as any).progress_pct) : 0;
    const currentPhase = typeof (current as any).phase === 'string' ? (current as any).phase : 'starting';
    nextPct = Math.max(currentProgress, progress_pct);
    // Preserve later phase if already advanced
    const order = ['starting','business_personas','dm_personas','business_discovery','decision_makers','market_research','completed','failed'];
    const curIdx = order.indexOf(normalizePhase(currentPhase));
    const newIdx = order.indexOf(normPhase);
    if (curIdx > -1 && newIdx > -1 && curIdx > newIdx) {
      nextPhase = normalizePhase(currentPhase);
    }
  }
  const updateData: Record<string, any> = {
    progress_pct: nextPct,
    phase: nextPhase,
    status, // status column is independent of check constraint
    updated_at: new Date().toISOString(),
  };
  if (status_detail) updateData.status_detail = status_detail;

  const { error } = await supa
    .from('user_searches')
    .update(updateData)
    .eq('id', search_id);

  if (error) throw error;
}

export const markSearchCompleted = async (search_id: string) => {
  const supa = getSupabaseClient();
  const { error } = await supa
    .from('user_searches')
    .update({ 
      status: 'completed', 
      progress_pct: 100, 
      phase: 'completed',
      updated_at: new Date().toISOString() 
    })
    .eq('id', search_id);
    
  if (error) throw error;
};

// API Usage Logging
export const logApiUsage = async (params: {
  user_id: string;
  search_id?: string;
  provider: 'serper' | 'deepseek' | 'gemini' | 'openai';
  endpoint?: string;
  status?: number;
  ms?: number;
  tokens?: number;
  cost_usd?: number;
  request?: any;
  response?: any;
}) => {
  try {
    const supa = getSupabaseClient();
    const isValidUuid = (v: any) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
    const safeUserId = isValidUuid(params.user_id) ? params.user_id : null;
    const allowedProvider = (p: any) => (p === 'serper' || p === 'deepseek' || p === 'gemini' || p === 'openai') ? p : 'openai';
    const { error } = await supa
      .from('api_usage_logs')
      .insert({
        // If user_id invalid or not present (e.g., local/dev), log with null to avoid FK errors
        user_id: safeUserId,
        search_id: params.search_id || null,
        provider: allowedProvider(params.provider),
        endpoint: params.endpoint || null,
        status: params.status || 200,
        ms: params.ms || 0,
        tokens: params.tokens || 0,
        cost_usd: params.cost_usd || 0,
        request: params.request || {},
        response: params.response || {}
      });
    
    if (error) {
      // If FK error, retry once with null user_id to avoid breaking the flow
      if ((error as any)?.code === '23503') {
        try {
          await supa.from('api_usage_logs').insert({
            user_id: null,
            search_id: params.search_id || null,
            provider: params.provider,
            endpoint: params.endpoint || null,
            status: params.status || 200,
            ms: params.ms || 0,
            tokens: params.tokens || 0,
            cost_usd: params.cost_usd || 0,
            request: params.request || {},
            response: params.response || {}
          });
        } catch (e: any) {
          logger.error('Failed to log API usage after FK retry', { error: e?.message || e });
        }
      } else {
        logger.error('Failed to log API usage', { error });
      }
      // Don't throw - API logging shouldn't break the main flow
    }
  } catch (error: any) {
    logger.error('Failed to log API usage', { error: error?.message || error });
    // Don't throw - API logging shouldn't break the main flow
  }
};

export const updateDecisionMakerEnrichment = async (dmId: string, enrichmentData: {
  email?: string;
  phone?: string;
  enrichment_status?: string;
  enrichment_confidence?: number;
  enrichment_sources?: string[];
  enrichment_error?: string;
}) => {
  const supa = getSupabaseClient();
  const { data, error } = await supa
    .from('decision_makers')
    .update({
      ...enrichmentData
    })
    .eq('id', dmId)
    .select('id,name,email,phone');
  
  if (error) throw error;
  return data;
};

// Update business contact details (email/phone/website) safely
export const updateBusinessContacts = async (
  businessId: string,
  updates: { email?: string; phone?: string; website?: string }
) => {
  const supa = getSupabaseClient();
  const payload: Record<string, any> = {};
  if (typeof updates.email === 'string' && updates.email.includes('@')) payload.email = updates.email;
  if (typeof updates.phone === 'string' && updates.phone.trim().length > 3) payload.phone = updates.phone.trim();
  if (typeof updates.website === 'string' && /^https?:\/\//i.test(updates.website)) payload.website = updates.website;
  if (Object.keys(payload).length === 0) return null;
  const { data, error } = await supa
    .from('businesses')
    .update(payload)
    .eq('id', businessId)
    .select('id,email,phone,website')
    .single();
  if (error) throw error;
  return data;
};
