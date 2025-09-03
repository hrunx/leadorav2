import logger from '../lib/logger';
import { supaServer } from '../lib/supaServer';
import { embed } from '../lib/embeddings';
import { fetchWithTimeoutRetry } from './util';

function extractText(html: string): string {
  try {
    const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
    const text = noScript.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&quot;|&#39;|&lt;|&gt;/g, ' ').replace(/\s+/g, ' ').trim();
    return text.slice(0, 12000);
  } catch {
    return '';
  }
}

function pickTokens(text: string, keywords: string[], max = 6): string[] {
  const lower = text.toLowerCase();
  const hits = new Set<string>();
  for (const key of keywords) {
    if (lower.includes(key.toLowerCase())) hits.add(key);
    if (hits.size >= max) break;
  }
  return Array.from(hits);
}

function extractDepartments(text: string): string[] {
  const catalog = [
    'Procurement','Sourcing','Supply Chain','Operations','Engineering','Manufacturing','Quality','R&D','IT','Technology','Security','Finance','Accounting','HR','People','Marketing','Sales','BD','Logistics','Compliance','Legal','Customer Success','Support'
  ];
  return pickTokens(text, catalog, 8);
}

function extractProducts(text: string): string[] {
  // Heuristic: look for common product/service words; keep short tokens
  const candidates = Array.from(new Set(
    (text.match(/(?:solutions?|products?|services?|platforms?|systems?)[^\.]{0,80}/gi) || [])
      .map(s => s.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi,'').trim())
  ));
  return candidates.slice(0, 8);
}

function extractRecentActivity(text: string): string[] {
  const lines = (text.match(/(?:launched|announced|partnership|acquired|opened|expanded|raised|funding|award|certified)[^\.]{0,120}\./gi) || [])
    .map(s => s.replace(/\s+/g,' ').trim());
  return lines.slice(0, 5);
}

function extractSize(text: string): string | null {
  const m = text.match(/(\b\d{2,5}\b)\s*(?:employees|staff|people|team)/i);
  if (m) return `${m[1]} employees`;
  return null;
}

function extractRevenue(text: string): string | null {
  const m = text.match(/\$\s?(\d{1,3}(?:[,\.]\d{3})*)(\s?[MB]illion|\s?[MB]|\s?m|\s?b)?/i);
  if (m) {
    const unit = m[2]?.trim() || '';
    return `$${m[1]}${unit ? ' ' + unit.toUpperCase() : ''}`;
  }
  return null;
}

export async function quickEnrichBusiness(businessId: string): Promise<void> {
  const supa: any = supaServer();
  try {
    const { data: biz } = await supa
      .from('businesses')
      .select('id,search_id,name,website,address,city,country,persona_id,industry,description')
      .eq('id', businessId)
      .maybeSingle();
    if (!biz) return;

    let text = '';
    const url = (biz as any).website as string | null;
    if (url && /^https?:\/\//i.test(url)) {
      try {
        const res = await fetchWithTimeoutRetry(url, { method: 'GET' }, 6000, 1, 600);
        if (res.ok) {
          const html = await res.text();
          text = extractText(html);
        }
      } catch {}
    }
    // Fallback to name + address if no site content retrieved
    if (!text) {
      text = [biz.name, biz.address, biz.city, biz.country].filter(Boolean).join(' ');
    }

    const relevant_departments = extractDepartments(text);
    const key_products = extractProducts(text);
    const recent_activity = extractRecentActivity(text);
    const size = extractSize(text) || null;
    const revenue = extractRevenue(text) || null;

    await supa
      .from('businesses')
      .update({
        relevant_departments,
        key_products,
        recent_activity,
        size: size || undefined,
        revenue: revenue || undefined,
      })
      .eq('id', businessId);

    logger.debug('[ENRICH] quick enrichment done', { business_id: businessId, deps: relevant_departments.length, prods: key_products.length });

    // Re-embed with enriched context to improve vector match
    try {
      const enrichedText = [biz.name, biz.industry || '', biz.country || '', biz.city || '', biz.description || '', relevant_departments.join(', '), key_products.join(', '), recent_activity.join('. ')].filter(Boolean).join('\n');
      const vec = await embed(enrichedText);
      try { await supa.rpc('set_business_embedding', { business_id: businessId, emb: vec as any }); }
      catch { await supa.from('businesses').update({ embedding: vec as any }).eq('id', businessId); }
      // Re-run vector persona match quickly
      try {
        const { data: match } = await supa.rpc('match_business_best_persona', { business_id: businessId }).maybeSingle();
        if (match && (match as any).persona_id) {
          const personaId = (match as any).persona_id as string;
          const score01 = Number((match as any).score || 0);
          const scorePct = Math.max(60, Math.min(100, Math.round(score01 * 100)));
          let personaTitle: string | undefined = undefined;
          try { const { data: p } = await supa.from('business_personas').select('title').eq('id', personaId).maybeSingle(); personaTitle = (p as any)?.title; } catch {}
          await supa.from('businesses').update({ persona_id: personaId, persona_type: personaTitle || 'mapped', match_score: scorePct }).eq('id', businessId);
        }
      } catch {}
    } catch {}
  } catch (e: any) {
    logger.warn('[ENRICH] quick enrichment failed', { business_id: businessId, error: e?.message || e });
  }
}


