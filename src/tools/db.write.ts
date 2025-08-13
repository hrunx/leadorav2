import { createClient } from '@supabase/supabase-js';
import logger from '../lib/logger';
import { randomUUID } from 'crypto';

// Create a memoized client for Netlify functions/server usage only
let _supaWrite: ReturnType<typeof createClient> | null = null;
const getSupabaseClient = () => {
  if (typeof window !== 'undefined') {
    throw new Error('db.write.ts must not be imported/used in the browser');
  }
  if (_supaWrite) return _supaWrite;
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL) throw new Error('supabaseUrl is required. Set SUPABASE_URL or VITE_SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('supabaseKey is required. Set SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_SERVICE_ROLE_KEY');
  _supaWrite = createClient(
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
  }
  return data!;
};

export const insertPersonaCache = async (cache_key: string, personas: any[]) => {
  const supa = getSupabaseClient();
  const { error } = await supa
    .from('persona_cache')
    .upsert({ cache_key, personas })
    .select('cache_key');
  if (error) throw error;
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
  }
  // Ensure returned objects include mandatory fields promised by callers
  const ensured = (data || []).map((ret, idx) => {
    const src = rows[idx] || rows[0];
    return {
      ...ret,
      country: ret.country ?? src.country,
      industry: ret.industry ?? src.industry,
    };
  });
  return ensured as typeof data;
};

export const insertDMPersonas = async (rows: any[]) => {
  const supa = getSupabaseClient();
  const { data, error } = await supa.from('decision_maker_personas').insert(rows).select('id,title,rank');
  if (error) throw error; 
  const search_id = rows?.[0]?.search_id as string | undefined;
  if (search_id) {
    try { await updateSearchTotals(search_id); } catch (e: any) { logger.warn('updateSearchTotals failed', { error: e?.message || e }); }
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
  const { data, error } = await supa.from('decision_makers').insert(basicRows).select('id,name,company,title,linkedin');
  if (error) throw error; 
  const search_id = basicRows?.[0]?.search_id as string | undefined;
  if (search_id) {
    try { await updateSearchTotals(search_id); } catch (e: any) { logger.warn('updateSearchTotals failed', { error: e?.message || e }); }
  }
  return data!;
};

// Update enrichment data for a specific decision maker - moved to end of file

export const insertMarketInsights = async (row: {
  search_id: string;
  user_id: string;
  tam_data: any;
  sam_data: any;
  som_data: any;
  competitor_data: any[];
  trends: any[];
  opportunities: any;
  sources?: any[];
  analysis_summary?: string;
  research_methodology?: string;
}) => {
  const supa = getSupabaseClient();
  const { data, error } = await supa.from('market_insights').insert(row).select('id').single();
  if (error) throw error;
  try { await updateSearchTotals(row.search_id); } catch (e: any) { logger.warn('updateSearchTotals failed', { error: e?.message || e }); }
  return data!;
};

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
    nextPct = Math.max(Number(current.progress_pct || 0), progress_pct);
    // Preserve later phase if already advanced
    const order = ['starting','business_personas','dm_personas','business_discovery','decision_makers','market_research','completed','failed'];
    const curIdx = order.indexOf(normalizePhase(current.phase || 'starting'));
    const newIdx = order.indexOf(normPhase);
    if (curIdx > -1 && newIdx > -1 && curIdx > newIdx) {
      nextPhase = normalizePhase(current.phase || 'starting');
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