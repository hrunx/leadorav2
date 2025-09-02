import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { sanitizePersona, type SearchContext } from '../../src/tools/persona-validation';

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'method_not_allowed' }) };
  try {
    const { search_id } = JSON.parse(event.body || '{}');
    if (!search_id || typeof search_id !== 'string') return { statusCode: 400, headers, body: JSON.stringify({ error: 'search_id required' }) };

    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;
    const supa = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

    // Load search context
    const { data: search } = await supa
      .from('user_searches')
      .select('industries, countries, search_type, product_service')
      .eq('id', search_id)
      .single();
    const ctx: SearchContext = {
      industries: (search?.industries as any) || [],
      countries: (search?.countries as any) || [],
      search_type: (search?.search_type === 'supplier' ? 'supplier' : 'customer')
    };

    let updated_bp = 0, updated_dm = 0;

    // Backfill business personas
    const { data: bps } = await supa
      .from('business_personas')
      .select('id, title, rank, match_score, demographics, characteristics, behaviors, market_potential, locations')
      .eq('search_id', search_id);
    if (Array.isArray(bps)) {
      for (let i = 0; i < bps.length; i++) {
        const p = bps[i] as any;
        const sanitized = sanitizePersona('business', p, (p.rank ? (p.rank - 1) : i), ctx);
        // Determine if update is needed (missing fields)
        const needUpdate = !p?.demographics?.companySize || !p?.demographics?.revenue ||
          !Array.isArray(p?.characteristics?.painPoints) || (p?.characteristics?.painPoints || []).length === 0 ||
          !p?.behaviors?.buyingProcess || !p?.behaviors?.decisionTimeline || !p?.behaviors?.budgetRange ||
          !p?.market_potential?.totalCompanies || !p?.market_potential?.avgDealSize || !p?.market_potential?.conversionRate ||
          !Array.isArray(p?.locations) || (p?.locations || []).length === 0;
        if (needUpdate) {
          await supa
            .from('business_personas')
            .update({
              title: sanitized.title || p.title,
              rank: sanitized.rank || p.rank || (i + 1),
              match_score: typeof p.match_score === 'number' && p.match_score > 0 ? p.match_score : sanitized.match_score,
              demographics: sanitized.demographics,
              characteristics: sanitized.characteristics,
              behaviors: sanitized.behaviors,
              market_potential: sanitized.market_potential,
              locations: sanitized.locations
            })
            .eq('id', p.id);
          updated_bp += 1;
        }
      }
    }

    // Backfill decision maker personas
    const { data: dms } = await supa
      .from('decision_maker_personas')
      .select('id, title, rank, match_score, demographics, characteristics, behaviors, market_potential')
      .eq('search_id', search_id);
    if (Array.isArray(dms)) {
      for (let i = 0; i < dms.length; i++) {
        const p = dms[i] as any;
        const sanitized = sanitizePersona('dm', p, (p.rank ? (p.rank - 1) : i), ctx);
        const needUpdate = !p?.demographics?.level || !p?.demographics?.department || !p?.demographics?.experience || !p?.demographics?.geography ||
          !Array.isArray(p?.characteristics?.responsibilities) || (p?.characteristics?.responsibilities || []).length === 0 ||
          !Array.isArray(p?.characteristics?.pain_points) || (p?.characteristics?.pain_points || []).length === 0 ||
          !Array.isArray(p?.characteristics?.motivations) || (p?.characteristics?.motivations || []).length === 0 ||
          !Array.isArray(p?.characteristics?.challenges) || (p?.characteristics?.challenges || []).length === 0 ||
          !Array.isArray(p?.characteristics?.decision_factors) || (p?.characteristics?.decision_factors || []).length === 0 ||
          !p?.behaviors?.decision_making || !p?.behaviors?.communication_style || !p?.behaviors?.buying_process || !Array.isArray(p?.behaviors?.preferred_channels) || (p?.behaviors?.preferred_channels || []).length === 0 ||
          !p?.market_potential?.total_decision_makers || !p?.market_potential?.avg_influence || !p?.market_potential?.conversion_rate;
        if (needUpdate) {
          await supa
            .from('decision_maker_personas')
            .update({
              title: sanitized.title || p.title,
              rank: sanitized.rank || p.rank || (i + 1),
              match_score: typeof p.match_score === 'number' && p.match_score > 0 ? p.match_score : sanitized.match_score,
              demographics: sanitized.demographics as any,
              characteristics: sanitized.characteristics as any,
              behaviors: sanitized.behaviors as any,
              market_potential: sanitized.market_potential as any
            })
            .eq('id', p.id);
          updated_dm += 1;
        }
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ updated_bp, updated_dm }) };
  } catch (e: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'backfill_failed' }) };
  }
};


