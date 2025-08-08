import { createClient } from '@supabase/supabase-js';

// Create a dedicated client for database operations that works in both browser and Netlify functions
const getSupabaseClient = () => {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { 
      auth: { 
        autoRefreshToken: false, 
        persistSession: false
      } 
    }
  );
};

export const insertBusinessPersonas = async (rows: any[]) => {
  const supa = getSupabaseClient();
  const { data, error } = await supa.from('business_personas').insert(rows).select('*');
  if (error) throw error;
  return data!;
};

// Patch insertBusinesses to guarantee returned objects always include country and industry
// Add a type/interface for the business row for type safety
// If Supabase omits these fields, explicitly add them from the input rows before returning
export const insertBusinesses = async (rows: any[]) => {
  const supa = getSupabaseClient();
  const { data, error } = await supa.from('businesses').insert(rows).select('*');
  if (error) throw error; 
  return data!;
};

export const insertDMPersonas = async (rows: any[]) => {
  const supa = getSupabaseClient();
  const { data, error } = await supa.from('decision_maker_personas').insert(rows).select('id,title,rank');
  if (error) throw error; 
  return data!;
};

// Insert basic DM data with enrichment_status = 'pending'
export const insertDecisionMakersBasic = async (rows: any[]) => {
  const basicRows = rows.map(row => ({
    ...row,
    id: row.id || undefined,
    linkedin: String(row.linkedin || ''),
    enrichment_status: 'pending' as const,
    enrichment: row.enrichment ?? null
  }));
  
  const supa = getSupabaseClient();
  const { data, error } = await supa.from('decision_makers').insert(basicRows).select('id,name,company,title,linkedin');
  if (error) throw error; 
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
  return data!;
};

// enforce allowed phases (must match DB CHECK constraint on user_searches.phase)
const AllowedPhases = new Set([
  'starting',
  'business_discovery',
  'business_personas',
  'dm_personas',
  'decision_makers',
  'market_research',
  'completed',
  'failed',
] as const);

type Phase = typeof AllowedPhases extends Set<infer T> ? T : never;

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
      return (AllowedPhases.has(p as Phase) ? (p as Phase) : 'starting');
  }
}

export async function updateSearchProgress(
  search_id: string,
  progress_pct: number,
  phase: string,
  status = 'in_progress'
) {
  const normPhase = normalizePhase(phase);
  const supa = getSupabaseClient();
  const { error } = await supa
    .from('user_searches')
    .update({
      progress_pct,
      phase: normPhase,
      status, // status column is independent of check constraint
      updated_at: new Date().toISOString(),
    })
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
    const { error } = await supa
      .from('api_usage_logs')
      .insert({
        // If user_id is not a valid auth.users id (e.g., local/dev), log with null to avoid FK errors
        user_id: params.user_id || null,
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
        } catch (e) {
          console.error('Failed to log API usage after FK retry:', e);
        }
      } else {
        console.error('Failed to log API usage:', error);
      }
      // Don't throw - API logging shouldn't break the main flow
    }
  } catch (error) {
    console.error('Failed to log API usage:', error);
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
      ...enrichmentData,
      updated_at: new Date().toISOString()
    })
    .eq('id', dmId)
    .select('id,name,email,phone');
  
  if (error) throw error;
  return data;
};