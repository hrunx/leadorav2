import { supa, resolveModel, callOpenAIChatJSON, callGeminiText, callDeepseekChatJSON } from '../agents/clients';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { mapDMToPersona } from './util';
import logger from '../lib/logger';

// ---- Types ----
export interface BusinessRow {
  id: string;
  name: string;
  industry: string;
  country: string;
  city?: string | null;
  size?: string | null;
  revenue?: string | null;
  description?: string | null;
  match_score?: number;
}

export interface BusinessPersonaRow {
  id: string;
  title: string;
  rank?: number;
  demographics?: { industry?: string; companySize?: string; geography?: string; revenue?: string };
  characteristics?: Record<string, unknown>;
}

export interface DecisionMakerRow {
  id: string;
  name: string;
  title: string;
  department?: string;
  level?: string;
}

export interface DMPersonaRow {
  id: string;
  title: string;
  rank?: number;
  demographics?: { level?: string; department?: string; experience?: string; geography?: string };
  characteristics?: Record<string, unknown>;
}

// AI JSON result shape
interface AiBestMatchJson {
  best?: { persona_id?: string; score?: number };
}

function parseAiBestMatch(text: string): { personaId: string; score: number } | null {
  try {
    const obj = JSON.parse(text) as AiBestMatchJson;
    const best = obj?.best;
    if (best?.persona_id) {
      return { personaId: String(best.persona_id), score: Number(best.score ?? 80) };
    }
  } catch { /* ignore */ }
  return null;
}

// ---- Lightweight rate limiter for LLM mapping ----
const MAX_CONCURRENT = 3;
let inFlight = 0;
const queue: Array<() => void> = [];
async function withLimiter<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const runNext = async () => {
      inFlight++;
      try { resolve(await fn()); } catch (e) { reject(e); } finally {
        inFlight--;
        const next = queue.shift();
        if (next) next();
      }
    };
    if (inFlight < MAX_CONCURRENT) runNext(); else queue.push(runNext);
  });
}

// ---- Throttling and de-duplication for mapping routines ----
const mappingLocks = new Set<string>();
const mappingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const mappingAttempts = new Map<string, number>();
const lockTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

async function scoreBusinessToPersonasLLM(business: BusinessRow, personas: BusinessPersonaRow[]): Promise<{ personaId: string; score: number } | null> {
  if (!personas || personas.length === 0) return null;
  const prompt = `You are matching a business to the most relevant business persona. Return ONLY JSON: {"best": {"persona_id": "...", "score": 0-100}}.

BUSINESS:
- name: ${business.name}
- industry: ${business.industry}
- size: ${business.size || ''}
- revenue: ${business.revenue || ''}
- country: ${business.country}
- city: ${business.city || ''}
- description: ${business.description || ''}

PERSONAS (JSON array):
${JSON.stringify(personas.map(p => ({ id: p.id, title: p.title, demographics: p.demographics })), null, 2)}

Rules:
- Choose the single best persona id by industry, company size, geography, description alignment.
- score: integer 0-100 for confidence.
- Output ONLY the specified JSON.`;
  const model = resolveModel('light');
  return withLimiter(async () => {
    try {
      const text = await callOpenAIChatJSON({ model, system: 'You output ONLY valid JSON.', user: prompt, temperature: 0.2, maxTokens: 500, requireJsonObject: true, verbosity: 'low' });
      const match = parseAiBestMatch(text);
      if (match) return match;
    } catch (e: any) {
      logger.warn('scoreBusinessToPersonasLLM (openai) failed', { error: e?.message || e });
    }
    try {
      const text = await callGeminiText('gemini-2.0-flash', prompt);
      const match = parseAiBestMatch(text);
      if (match) return match;
    } catch (e: any) {
      logger.warn('scoreBusinessToPersonasLLM (gemini) failed', { error: e?.message || e });
    }
    try {
      const text = await callDeepseekChatJSON({ user: prompt, temperature: 0.3, maxTokens: 500, timeoutMs: 15000, retries: 0 });
      const match = parseAiBestMatch(text);
      if (match) return match;
    } catch (e: any) {
      logger.warn('scoreBusinessToPersonasLLM (deepseek) failed', { error: e?.message || e });
    }
    return null;
  });
}

async function scoreDMToPersonasLLM(dm: DecisionMakerRow, personas: DMPersonaRow[]): Promise<{ personaId: string; score: number } | null> {
  if (!personas || personas.length === 0) return null;
  const prompt = `You are matching a decision maker to the most relevant decision-maker persona. Return ONLY JSON: {"best": {"persona_id": "...", "score": 0-100}}.

DECISION_MAKER:
- name: ${dm.name}
- title: ${dm.title}
- level: ${dm.level || ''}
- department: ${dm.department || ''}

PERSONAS (JSON array):
${JSON.stringify(personas.map(p => ({ id: p.id, title: p.title, demographics: p.demographics })), null, 2)}

Rules:
- Choose the single best persona id by title/level/department alignment.
- score: integer 0-100.
- Output ONLY the specified JSON.`;
  const model = resolveModel('light');
  return withLimiter(async () => {
    try {
      let text = await callOpenAIChatJSON({ model, system: 'Return ONLY JSON.', user: prompt, temperature: 0.2, maxTokens: 400, requireJsonObject: true, verbosity: 'low' });
      const match = parseAiBestMatch(text);
      if (match) return match;
    } catch (e: any) {
      logger.warn('scoreDMToPersonasLLM (openai) failed', { error: e?.message || e });
    }
    try {
      const text = await callGeminiText('gemini-2.0-flash', prompt);
      const match = parseAiBestMatch(text);
      if (match) return match;
    } catch (e: any) {
      logger.warn('scoreDMToPersonasLLM (gemini) failed', { error: e?.message || e });
    }
    try {
      const text = await callDeepseekChatJSON({ user: prompt, temperature: 0.3, maxTokens: 400, timeoutMs: 15000, retries: 0 });
      const match = parseAiBestMatch(text);
      if (match) return match;
    } catch (e: any) {
      logger.warn('scoreDMToPersonasLLM (deepseek) failed', { error: e?.message || e });
    }
    return null;
  });
}

// Intelligent business-persona matching functions
function findBestMatchingPersona(business: BusinessRow, personas: BusinessPersonaRow[]): BusinessPersonaRow {
  let bestPersona = personas[0];
  let bestScore = 0;

  for (const persona of personas) {
    const score = calculatePersonaMatchScore(business, persona);
    if (score > bestScore) {
      bestScore = score;
      bestPersona = persona;
    }
  }

  return bestPersona;
}

function calculatePersonaMatchScore(business: BusinessRow, persona: BusinessPersonaRow): number {
  let score = business.match_score || 75; // Base score

  // Analyze business characteristics for persona compatibility
  const businessName = (business.name || '').toLowerCase();
  const businessDesc = (business.description || '').toLowerCase();
  const businessIndustry = (business.industry || '').toLowerCase();
  const businessSize = (business.size || '').toLowerCase();
  const businessRevenue = (business.revenue || '').toLowerCase();
  
  const personaTitle = (persona.title || '').toLowerCase();
  const personaDemos = persona.demographics || {};
  const personaChars = persona.characteristics || {};
  
  // Size-based matching
  if (businessSize.includes('small') || businessSize.includes('startup')) {
    if (personaTitle.includes('small') || personaTitle.includes('startup') || personaTitle.includes('emerging')) {
      score += 15;
    }
  } else if (businessSize.includes('large') || businessSize.includes('enterprise')) {
    if (personaTitle.includes('large') || personaTitle.includes('enterprise') || personaTitle.includes('corporate')) {
      score += 15;
    }
  }

  // Revenue-based matching
  if (businessRevenue.includes('million') || businessRevenue.includes('high')) {
    if (personaTitle.includes('premium') || personaTitle.includes('enterprise') || personaTitle.includes('corporate')) {
      score += 10;
    }
  }

  // Industry-specific matching
  if (businessIndustry) {
    const personaIndustry = (personaDemos as any)?.industry as string | undefined;
    if (personaTitle.includes(businessIndustry) || (personaIndustry && personaIndustry.toLowerCase().includes(businessIndustry))) {
      score += 20;
    }
  }

  // Technology/Innovation matching
  if (businessName.includes('tech') || businessDesc.includes('software') || businessDesc.includes('digital')) {
    if (personaTitle.includes('tech') || personaTitle.includes('digital') || personaTitle.includes('innovative')) {
      score += 10;
    }
  }

  // Traditional business matching
  if (businessDesc.includes('traditional') || businessDesc.includes('established') || businessDesc.includes('family')) {
    if (personaTitle.includes('traditional') || personaTitle.includes('established') || personaTitle.includes('conservative')) {
      score += 10;
    }
  }

  // Geographic considerations (if available)
  const businessLocation = (business.city || business.country || '').toLowerCase();
  if (businessLocation.includes('urban') || businessLocation.includes('city')) {
    if (personaTitle.includes('urban') || personaTitle.includes('metropolitan')) {
      score += 5;
    }
  }

  // Keyword overlap between business description and persona characteristics
  if (personaChars) {
    const charsStr = JSON.stringify(personaChars).toLowerCase();
    const keywords = ['energy','logistics','supply','diesel','retail','manufacturing','healthcare','finance','saas','crm','automation'];
    let hits = 0;
    for (const k of keywords) {
      if (businessDesc.includes(k) && charsStr.includes(k)) hits++;
    }
    score += Math.min(hits * 3, 15);
  }

  // Revenue/size alignment bonus if persona demographics encode ranges
  if (personaDemos && typeof personaDemos.companySize === 'string') {
    const size = personaDemos.companySize.toLowerCase();
    if (businessSize && size.includes(businessSize.split('-')[0])) score += 5;
  }

  // Ensure score doesn't exceed reasonable bounds
  return Math.min(score, 100);
}

/**
 * Maps any businesses without a persona assignment to the available personas.
 *
 * When called repeatedly this function will only operate on businesses that
 * have not yet been mapped (persona_id is null) which enables incremental
 * updates as new businesses arrive.
 */
export async function mapBusinessesToPersonas(searchId: string, businessId?: string) {
  try {
    if (mappingLocks.has(searchId)) {
      // Prevent concurrent re-entrant mapping cycles for the same search
      return;
    }
    mappingLocks.add(searchId);
    const timeout = setTimeout(() => {
      if (mappingLocks.delete(searchId)) {
        logger.warn('Persona mapping lock timed out', { searchId });
      }
      lockTimeouts.delete(searchId);
    }, 60000);
    lockTimeouts.set(searchId, timeout);
    logger.info('Starting persona mapping', { searchId });

    // Ensure business personas exist before mapping
    // Abort quickly if the search is not active (completed/failed/cancelled)
    let searchStatus: string | undefined = undefined;
    try {
      const { data: s } = await supa.from('user_searches').select('status,phase').eq('id', searchId).single();
      searchStatus = s?.status;
      if (s && s.status && s.status !== 'in_progress') {
        logger.info('Skipping persona mapping due to non-active status', { searchId, status: s.status });
        return;
      }
    } catch {}

    const { data: personaCheck } = await supa
      .from('business_personas')
      .select('id')
      .eq('search_id', searchId)
      .limit(1);
    if (!personaCheck || personaCheck.length === 0) {
      if (searchStatus && searchStatus !== 'in_progress') {
        logger.info('Not scheduling persona mapping deferral because search is not active', { searchId, status: searchStatus });
        return;
      }
      const attempts = (mappingAttempts.get(searchId) || 0) + 1;
      mappingAttempts.set(searchId, attempts);
      if (attempts > 12) { // ~1 minute max
        logger.warn('Stopping persona mapping deferrals after max attempts with no personas', { searchId, attempts });
        mappingTimers.delete(searchId);
        mappingLocks.delete(searchId);
        const tmo = lockTimeouts.get(searchId);
        if (tmo) { clearTimeout(tmo); lockTimeouts.delete(searchId); }
        // preserve attempts for diagnostics; do not delete here
        return;
      }
      if (!mappingTimers.has(searchId)) {
        logger.debug('Business personas not ready yet. Deferring mapping by 5s.', { searchId, attempts });
        const t = setTimeout(() => {
          mappingTimers.delete(searchId);
          mapBusinessesToPersonas(searchId, businessId).catch(()=>{});
        }, 5000);
        mappingTimers.set(searchId, t);
      }
      return;
    }

    // Only load businesses that don't yet have a persona mapping. Optionally
    // limit to a single business when an id is provided.
    const businessQuery = supa
      .from('businesses')
      .select('*')
      .eq('search_id', searchId)
      .is('persona_id', null);
    if (businessId) businessQuery.eq('id', businessId);
    const { data: businesses, error: businessError } = await businessQuery;

    if (businessError) throw businessError;
    if (!businesses || businesses.length === 0) {
      logger.debug('No businesses found requiring persona mapping', { searchId });
      mappingAttempts.delete(searchId);
      return;
    }

    // Get all personas for this search
    const { data: personas, error: personaError } = await supa
      .from('business_personas')
      .select('*')
      .eq('search_id', searchId)
      .order('rank');

    if (personaError) throw personaError;
    if (!personas || personas.length === 0) {
      const attempts = (mappingAttempts.get(searchId) || 0) + 1;
      mappingAttempts.set(searchId, attempts);
      if (attempts > 12) {
        logger.warn('Stopping persona mapping retries after max attempts (no personas)', { searchId, attempts });
        mappingTimers.delete(searchId);
        return;
      }
      logger.debug('No personas available yet for mapping, retrying in background', { searchId, attempts });
      // retry later without throwing to avoid blocking inserts
      setTimeout(() => {
        mapBusinessesToPersonas(searchId, businessId).catch(() => {});
      }, 5000);
      return;
    }

    logger.info('Mapping businesses to personas', { businesses: businesses.length, personas: personas.length, searchId });

    // Intelligent mapping logic: prefer vector similarity, fallback to AI/heuristic
    const updates = businesses.map(async (business: BusinessRow) => {
      let bestId: string | null = null;
      let scoreNum = 0;
      // Try embedding‑based match first (fast, deterministic)
      try {
        const { data: vec } = await supa.rpc('match_business_best_persona', { business_id: business.id }).maybeSingle();
        if (vec && (vec as any).persona_id) {
          bestId = String((vec as any).persona_id);
          const s = Number((vec as any).score || 0);
          scoreNum = Math.max(60, Math.min(100, Math.round(s * 100)));
        }
      } catch {}
      // If no vector match, attempt AI semantic scoring
      if (!bestId) {
        const ai = await scoreBusinessToPersonasLLM(business, personas as unknown as BusinessPersonaRow[]).catch(() => null);
        if (ai && ai.personaId) { bestId = ai.personaId; scoreNum = ai.score; }
      }
      if (!bestId) {
        const bestPersona = findBestMatchingPersona(business, personas);
        bestId = bestPersona.id; scoreNum = calculatePersonaMatchScore(business, bestPersona);
      }
      return supa
        .from('businesses')
        .update({ persona_id: bestId, persona_type: (personas.find(p=>p.id===bestId)?.title) || 'mapped', match_score: Math.min(scoreNum, 100) })
        .eq('id', business.id);
    });

    // Execute all updates in parallel
    const results = await Promise.allSettled(updates);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    logger.info('Persona mapping completed', { successful, failed, total: businesses.length, searchId });
    mappingAttempts.delete(searchId);

    return { successful, failed, total: businesses.length };
  } catch (error: any) {
    logger.error('Error mapping businesses to personas', { searchId, error: error?.message || error });
    throw error;
  }
  finally {
    const t = lockTimeouts.get(searchId);
    if (t) {
      clearTimeout(t);
      lockTimeouts.delete(searchId);
    }
    mappingLocks.delete(searchId);
  }
}

/**
 * Starts a Supabase realtime listener that maps businesses to personas whenever
 * a new business row is inserted for the given search.
 *
 * Returns a cleanup function that should be awaited to unsubscribe from the
 * realtime channel when work is complete.
 */
export function startPersonaMappingListener(searchId: string) {
  const channel = supa
    .channel(`persona-mapper-${searchId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'businesses',
        filter: `search_id=eq.${searchId}`
      },
      (payload: RealtimePostgresChangesPayload<{ id: string }>) => {
        const newRow = (payload.new || {}) as { id?: string };
        if (!newRow.id) return;
        mapBusinessesToPersonas(searchId, newRow.id).catch(err =>
          logger.warn('Error mapping persona for new business', { searchId, error: err?.message || err })
        );
      }
    )
    .subscribe();

  return async () => {
    await supa.removeChannel(channel);
  };
}

/**
 * Simple business-to-persona mapping as fallback
 */
export async function simpleBusinessPersonaMapping(searchId: string) {
  try {
    logger.info('Starting simple business persona mapping', { searchId });

    // Get businesses and personas
    const [businessResult, personaResult] = await Promise.all([
      supa.from('businesses').select('*').eq('search_id', searchId).is('persona_id', null),
      supa.from('business_personas').select('*').eq('search_id', searchId).order('rank')
    ]);
    
    if (businessResult.error) throw businessResult.error;
    if (personaResult.error) throw personaResult.error;
    
    const businesses = businessResult.data || [];
    const personas = personaResult.data || [];
    
    if (businesses.length === 0 || personas.length === 0) {
      logger.debug('No businesses or personas found for mapping', { searchId });
      return { successful: 0, failed: 0, total: 0 };
    }

    // Simple deterministic mapping based on industry and size
    const updates = businesses.map(async (business: BusinessRow) => {
      const bestPersona = findBestMatchingPersona(business, personas as unknown as BusinessPersonaRow[]);
      const matchScore = calculatePersonaMatchScore(business, bestPersona);
      
      return supa
        .from('businesses')
        .update({
          persona_id: bestPersona.id,
          persona_type: bestPersona.title,
          match_score: Math.min(matchScore, 100)
        })
        .eq('id', business.id);
    });
    
    const results = await Promise.allSettled(updates);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    
    logger.info('Simple persona mapping completed', { successful, total: businesses.length, searchId });
    
    return { successful, failed: businesses.length - successful, total: businesses.length };
  } catch (error: any) {
    logger.error('Error in simple persona mapping', { searchId, error: error?.message || error });
    return { successful: 0, failed: 0, total: 0 };
  }
}

/**
 * Enhanced persona mapping using AI-based matching
 * This provides more intelligent mapping based on business characteristics
 */
export async function intelligentPersonaMapping(searchId: string) {
    try {
    // Get businesses and personas
    const [businessResult, personaResult] = await Promise.all([
      supa.from('businesses').select('*').eq('search_id', searchId),
      supa.from('business_personas').select('*').eq('search_id', searchId).order('rank')
    ]);
    
    if (businessResult.error) throw businessResult.error;
    if (personaResult.error) throw personaResult.error;
    
    const businesses = businessResult.data || [];
    const personas = personaResult.data || [];
    
      if (businesses.length === 0 || personas.length === 0) {
      logger.debug('Insufficient data for intelligent mapping', { searchId });
      return await simpleBusinessPersonaMapping(searchId); // Fallback to simple mapping
    }
    
    // AI-first semantic matching with deterministic fallback per business
    const updates = businesses.map(async (business: BusinessRow) => {
      let bestId: string | null = null;
      let scoreNum = 0;
      try {
        const ai = await scoreBusinessToPersonasLLM(business, personas as unknown as BusinessPersonaRow[]);
        if (ai && ai.personaId) {
          bestId = ai.personaId;
          scoreNum = ai.score || 80;
        }
      } catch (e: any) {
        logger.warn('intelligentPersonaMapping AI step failed', { searchId, error: e?.message || e });
      }
      if (!bestId) {
        const best = findBestMatchingPersona(business, personas as unknown as BusinessPersonaRow[]);
        bestId = best.id;
        scoreNum = calculatePersonaMatchScore(business, best);
      }
      return supa
        .from('businesses')
        .update({
          persona_id: bestId,
          persona_type: (personas.find(p => p.id === bestId)?.title) || 'mapped',
          match_score: Math.min(scoreNum, 100)
        })
        .eq('id', business.id);
    });
    
    const results = await Promise.allSettled(updates);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    
    logger.info('Intelligent persona mapping completed', { successful, total: businesses.length, searchId });
    
    return { successful, failed: businesses.length - successful, total: businesses.length };
  } catch (error: any) {
    logger.error('Error in intelligent persona mapping', { searchId, error: error?.message || error });
    // Fallback to simple mapping
    return await simpleBusinessPersonaMapping(searchId);
  }
}

/**
 * Maps decision makers without persona assignments once personas are available
 */
export async function mapDecisionMakersToPersonas(searchId: string) {
  try {
    logger.info('Starting DM persona mapping', { searchId });

    // Ensure DM personas exist before mapping
    const { data: personaCheck } = await supa
      .from('decision_maker_personas')
      .select('id')
      .eq('search_id', searchId)
      .limit(1);
    if (!personaCheck || personaCheck.length === 0) {
      logger.debug('DM personas not ready yet. Deferring mapping by 5s.', { searchId });
      setTimeout(() => { mapDecisionMakersToPersonas(searchId).catch(()=>{}); }, 5000);
      return;
    }

    const { data: dms, error: dmError } = await supa
      .from('decision_makers')
      .select('id,title,department,level,name')
      .eq('search_id', searchId)
      .is('persona_id', null);

    if (dmError) throw dmError;
    if (!dms || dms.length === 0) {
      logger.debug('No decision makers found requiring persona mapping', { searchId });
      return;
    }

    const { data: personas, error: personaError } = await supa
      .from('decision_maker_personas')
      .select('id,title,rank,demographics')
      .eq('search_id', searchId)
      .order('rank');

    if (personaError) throw personaError;
    if (!personas || personas.length === 0) {
      logger.debug('No DM personas available yet for mapping', { searchId });
      return;
    }

    const updates = dms.map(async (dm: { id: string; title: string; department?: string; level?: string; name: string }) => {
      let bestId: string | null = null;
      // Vector-first mapping
      try {
        const { data: top2 } = await supa.rpc('match_dm_top2_personas', { dm_id: dm.id });
        if (Array.isArray(top2) && top2.length) {
          const a = top2[0];
          bestId = String((a as any).persona_id);
          // epsilon tie-break: if top2 within 0.03 score difference, try LLM refinement
          if (top2.length > 1) {
            const s0 = Number((top2[0] as any).score || 0);
            const s1 = Number((top2[1] as any).score || 0);
            if (Math.abs(s0 - s1) <= 0.03) {
              const ai = await scoreDMToPersonasLLM(dm as unknown as DecisionMakerRow, personas as unknown as DMPersonaRow[]).catch(() => null);
              if (ai && ai.personaId) bestId = ai.personaId;
            }
          }
        }
      } catch {}
      // Heuristic fallback
      if (!bestId) {
        const persona = mapDMToPersona(dm as unknown as { title?: string }, personas as unknown as Array<{ id?: string; title?: string }>);
        const fallbackId = (persona && (persona as any).id) ? String((persona as any).id) : String(personas[0]?.id);
        bestId = fallbackId;
      }
      return supa.from('decision_makers').update({ persona_id: bestId }).eq('id', dm.id);
    });

    const results = await Promise.allSettled(updates);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    logger.info('DM persona mapping completed', { successful, failed, total: dms.length, searchId });

    return { successful, failed, total: dms.length };
  } catch (error: any) {
    logger.error('Error mapping decision makers to personas', { searchId, error: error?.message || error });
    throw error;
  }
}
