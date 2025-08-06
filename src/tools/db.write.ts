import { supa } from '../agents/clients';

export const insertBusinessPersonas = async (rows: any[]) => {
  const { data, error } = await supa.from('business_personas').insert(rows).select('id,title,rank');
  if (error) throw error; 
  return data!;
};

export const insertBusinesses = async (rows: any[]) => {
  const { data, error } = await supa.from('businesses').insert(rows).select('id,name,persona_id');
  if (error) throw error; 
  return data!;
};

export const insertDMPersonas = async (rows: any[]) => {
  const { data, error } = await supa.from('decision_maker_personas').insert(rows).select('id,title,rank');
  if (error) throw error; 
  return data!;
};

// Insert basic DM data with enrichment_status = 'pending'
export const insertDecisionMakersBasic = async (rows: any[]) => {
  const basicRows = rows.map(row => ({
    ...row,
    enrichment_status: 'pending' as const,
    enrichment: null
  }));
  
  const { data, error } = await supa.from('decision_makers').insert(basicRows).select('id,name,company,title,linkedin');
  if (error) throw error; 
  return data!;
};

// Update enrichment data for a specific decision maker
export const updateDecisionMakerEnrichment = async (id: string, enrichmentData: any) => {
  const { data, error } = await supa
    .from('decision_makers')
    .update({
      enrichment_status: 'done' as const,
      enrichment: enrichmentData,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select('id,name');
    
  if (error) throw error;
  return data;
};

export const insertMarketInsights = async (row: any) => {
  const { data, error } = await supa.from('market_insights').insert(row).select('id').single();
  if (error) throw error; 
  return data!;
};

// enforce allowed phases
const AllowedPhases = new Set([
  'starting',
  'personas',
  'businesses',
  'dm_personas',
  'decision_makers',
  'market_insights',
  'completed',
  'completed_with_warnings',
  'failed',
] as const);

type Phase = typeof AllowedPhases extends Set<infer T> ? T : never;

// Normalize old labels used in code
function normalizePhase(p: string): Phase {
  switch (p) {
    case 'created': return 'starting';
    case 'in_progress': return 'starting';
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
  const { error } = await supa
    .from('user_searches')
    .update({ 
      status: 'completed', 
      progress_pct: 100, 
      current_phase: 'completed',
      updated_at: new Date().toISOString() 
    })
    .eq('id', search_id);
    
  if (error) throw error;
};

// API Usage Logging
export const logApiUsage = async (params: {
  user_id: string;
  search_id?: string;
  provider: 'serper' | 'deepseek' | 'gemini';
  endpoint?: string;
  status?: number;
  ms?: number;
  tokens?: number;
  cost_usd?: number;
  request?: any;
  response?: any;
}) => {
  try {
    const { error } = await supa
      .from('api_usage_logs')
      .insert({
        user_id: params.user_id,
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
      console.error('Failed to log API usage:', error);
      // Don't throw - API logging shouldn't break the main flow
    }
  } catch (error) {
    console.error('Failed to log API usage:', error);
    // Don't throw - API logging shouldn't break the main flow
  }
};