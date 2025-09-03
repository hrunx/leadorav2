import logger from '../lib/logger';
import { supaServer } from '../lib/supaServer';
import { serperSearch } from './serper';
import { embed } from '../lib/embeddings';

function inferLevel(title: string): 'executive' | 'director' | 'manager' {
  const t = (title || '').toLowerCase();
  if (/chief|c[\w]?o\b|vp\b|vice president|head of|executive/.test(t)) return 'executive';
  if (/director/.test(t)) return 'director';
  return 'manager';
}

function inferDepartment(title: string): string {
  const t = (title || '').toLowerCase();
  if (/procure|purchase|supply|sourcing/.test(t)) return 'Procurement';
  if (/manufactur|operation|plant|factory|production/.test(t)) return 'Operations';
  if (/it|tech|engineer|cio|cto|digital/.test(t)) return 'Technology';
  if (/marketing|brand|growth/.test(t)) return 'Marketing';
  if (/sales|revenue|commercial|biz dev|business development/.test(t)) return 'Sales';
  if (/finance|cfo|account/.test(t)) return 'Finance';
  if (/hr|people|talent/.test(t)) return 'Human Resources';
  return 'General Management';
}

function extractPersonFromSerperItem(item: { title: string; link: string; snippet: string }, company: string) {
  const rawTitle = item.title || '';
  // Common patterns: "Name - Title - Company | LinkedIn" or "Title - Company - Name | LinkedIn"
  const cleaned = rawTitle.replace(/\s*\|\s*LinkedIn.*/i, '');
  const parts = cleaned.split(' - ').map(s => s.trim()).filter(Boolean);
  let name = '';
  let title = '';
  let comp = '';
  if (parts.length >= 3) {
    // Heuristic: whichever segment matches company name is company
    const idxCompany = parts.findIndex(p => p.toLowerCase().includes(company.toLowerCase()));
    if (idxCompany >= 0) {
      comp = parts[idxCompany];
      const remaining = parts.filter((_p, i) => i !== idxCompany);
      // Assume the segment with 2+ words, capitalized, is name
      const nameIdx = remaining.findIndex(p => /[A-Z][a-z]+\s+[A-Z][a-z]+/.test(p));
      if (nameIdx >= 0) {
        name = remaining[nameIdx];
        title = remaining.filter((_p, i) => i !== nameIdx).join(' - ');
      } else {
        // Fallback: first is name, second is title
        name = remaining[0] || '';
        title = remaining.slice(1).join(' - ');
      }
    } else {
      // Fallback: assume format Name - Title - Company
      [name, title, comp] = [parts[0], parts.slice(1, parts.length - 1).join(' - '), parts[parts.length - 1]];
    }
  } else if (parts.length === 2) {
    // Name - Title
    [name, title] = parts;
    comp = company;
  } else {
    // Single part – try to split by comma
    const csv = cleaned.split(',');
    name = csv[0]?.trim() || '';
    title = csv.slice(1).join(',').trim();
    comp = company;
  }
  // Extract phone/email from snippet
  const snip = (item.snippet || '').toLowerCase();
  const emailMatch = snip.match(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/);
  const phoneMatch = snip.match(/\+?\d[\d\s().-]{7,}\d/);
  return {
    name: name || '',
    title: title || '',
    company: comp || company,
    linkedin: item.link || '',
    email: emailMatch ? emailMatch[0] : '',
    phone: phoneMatch ? phoneMatch[0] : '',
  };
}

export async function enrichDecisionMakersFromSingleLinkedInSearch(params: {
  search_id: string;
  user_id: string;
  business_id: string;
  company: string;
  country: string;
  personaTitles: string[]; // up to 3
}): Promise<number> {
  const { search_id, user_id, business_id, company, country, personaTitles } = params;
  const supa: any = supaServer();
  try {
    // Build single query (more permissive):
    // - Normalize company aliases to account for punctuation and suffixes (Co., Ltd, LLC, etc.)
    // - Simplify persona titles by removing parentheticals/regions and trailing qualifiers
    // - Keep to ONE query while broadening match likelihood
    const buildCompanyAliases = (raw: string): string[] => {
      const base = (raw || '').trim();
      if (!base) return [];
      // Remove common punctuation/suffixes
      const noPunct = base.replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
      const stripped = noPunct.replace(/\b(company|co|co ltd|co limited|limited|ltd|llc|inc|corp|corporation)\b/gi, '').replace(/\s+/g, ' ').trim();
      const tokens = stripped.split(' ').filter(Boolean);
      const short = tokens.length > 2 ? tokens.slice(0, 2).join(' ') : stripped;
      const uniq = Array.from(new Set([base, noPunct, stripped, short].filter(Boolean)));
      return uniq;
    };

    const simplifyTitle = (raw: string): string => {
      if (!raw) return '';
      let t = raw.replace(/\([^)]*\)/g, '') // remove parentheticals like (KSA)
                 .split(' - ')[0]             // keep core role before hyphen
                 .replace(/\s+/g, ' ')
                 .trim();
      // Remove geographic qualifiers/prefixes
      t = t.replace(/^country\s+/i, '')
           .replace(/^regional\s+/i, '')
           .replace(/\bksa\b/ig, '')
           .replace(/\s+/g, ' ').trim();
      return t;
    };

    const companyAliases = buildCompanyAliases(company).slice(0, 3);
    const companyClause = companyAliases.length
      ? `(${companyAliases.map(a => `"${a}"`).join(' OR ')})`
      : `"${company}"`;

    const simplifiedTitles = (personaTitles || [])
      .filter(Boolean)
      .slice(0, 3)
      .map(simplifyTitle)
      .filter(Boolean);
    const titleClause = simplifiedTitles.length
      ? `(${simplifiedTitles.map(t => `"${t}"`).join(' OR ')})`
      : '';

    const q = `site:linkedin.com/in ${companyClause} ${titleClause}`.trim();
    logger.info('[DM-ONE-SEARCH] query', { q, company, titles_in: personaTitles, titles_simplified: simplifiedTitles, company_aliases: companyAliases });
    let res = await serperSearch(q, country, 10);
    if (res.success && (!res.items || res.items.length === 0)) {
      // Fallback 1: drop title clause
      const qCompanyOnly = `site:linkedin.com/in ${companyClause}`;
      logger.info('[DM-ONE-SEARCH] fallback company-only query', { q: qCompanyOnly });
      res = await serperSearch(qCompanyOnly, country, 10);
    }
    if (!res.success) return 0;
    const items = res.items || [];
    const parsed = items
      .filter(i => (i.link || '').includes('linkedin.com/in/'))
      .map(i => extractPersonFromSerperItem(i as any, company))
      .filter(p => p.name && p.title && p.linkedin);
    if (parsed.length === 0) return 0;

    // Upsert decision makers in bulk
    const rows = await Promise.all(parsed.map(async p => {
      const level = inferLevel(p.title);
      const department = inferDepartment(p.title);
      const influence = level === 'executive' ? 95 : level === 'director' ? 80 : 65;
      // Embed for fast persona mapping
      const vec = await embed([p.title, department, company, country].filter(Boolean).join('\n'));
      return {
        search_id,
        user_id,
        business_id,
        persona_id: null,
        name: p.name,
        title: p.title,
        level,
        influence,
        department,
        company,
        location: country,
        email: p.email || null,
        phone: p.phone || null,
        linkedin: p.linkedin || '',
        persona_type: 'dm_candidate',
        enrichment_status: 'pending',
        enrichment_confidence: 70,
        embedding: vec as any
      } as any;
    }));

    // Upsert with unique constraint (search_id, linkedin)
    const { error: upErr } = await supa
      .from('decision_makers')
      .upsert(rows, { onConflict: 'search_id,linkedin' });
    if (upErr) logger.warn('[DM-ONE-SEARCH] upsert error', { error: upErr.message || String(upErr) });

    // Map each DM to best persona via vector RPC and enrich with persona fields
    try {
      const { data: dms } = await supa
        .from('decision_makers')
        .select('id')
        .eq('search_id', search_id)
        .eq('business_id', business_id)
        .eq('persona_type', 'dm_candidate')
        .order('created_at', { ascending: false })
        .limit(rows.length);
      const ids = (dms || []).map((r: any) => r.id);
      await Promise.all(ids.map(async (id: string) => {
        try {
          const { data: top2 } = await supa.rpc('match_dm_top2_personas', { dm_id: id });
          if (Array.isArray(top2) && top2.length) {
            const best = top2[0] as any;
            const personaId = best.persona_id as string;
            const score01 = Number(best.score || 0);
            const match_score = Math.max(60, Math.min(100, Math.round(score01 * 100)));
            let persona: any = null;
            try {
              const { data: p } = await supa
                .from('decision_maker_personas')
                .select('title,demographics,characteristics,behaviors')
                .eq('id', personaId)
                .maybeSingle();
              persona = p;
            } catch {}
            const update: any = { persona_id: personaId, match_score };
            if (persona) {
              // Enrich DM fields from persona characteristics when missing
              update.pain_points = Array.isArray(persona.characteristics?.painPoints) ? persona.characteristics.painPoints : null;
              update.motivations = Array.isArray(persona.characteristics?.motivations) ? persona.characteristics.motivations : null;
              update.decision_factors = Array.isArray(persona.characteristics?.decisionFactors) ? persona.characteristics.decisionFactors : null;
              update.persona_type = persona.title || 'decision_maker';
            }
            await supa.from('decision_makers').update(update).eq('id', id);
          }
        } catch {}
      }));
    } catch {}

    return rows.length;
  } catch (e: any) {
    logger.warn('[DM-ONE-SEARCH] failed', { error: e?.message || String(e) });
    return 0;
  }
}


