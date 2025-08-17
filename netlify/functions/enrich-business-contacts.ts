import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { serperSearch } from '../../src/tools/serper';
import { updateBusinessContacts } from '../../src/tools/db.write';
import logger from '../../src/lib/logger';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function extractEmails(text: string): string[] {
  const emails = new Set<string>();
  const regex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text))) emails.add(m[0]);
  return Array.from(emails);
}

function extractPhones(text: string): string[] {
  const phones = new Set<string>();
  const regex = /\+?\d[\d\s().-]{6,}\d/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text))) phones.add(m[0]);
  return Array.from(phones);
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
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  try {
    const { search_id } = JSON.parse(event.body || '{}');
    if (!search_id) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'search_id required' }) };
    }

    const { data: businesses, error } = await supa
      .from('businesses')
      .select('id,name,country,website,email,phone')
      .eq('search_id', search_id)
      .order('created_at', { ascending: true });
    if (error) throw error;

    let enriched = 0;
    for (const biz of (businesses || [])) {
      const needEmail = !biz.email;
      const needPhone = !biz.phone;
      const needSite = !biz.website;
      if (!needEmail && !needPhone && !needSite) continue;
      const q = `${biz.name} contact ${biz.country || ''}`.trim();
      try {
        const r = await serperSearch(q, biz.country || 'United States', 5);
        if (r && r.success && Array.isArray(r.items) && r.items.length) {
          const snippetText = r.items.map(x => `${x.title}\n${x.snippet}\n${x.link}`).join('\n');
          const emails = extractEmails(snippetText);
          const phones = extractPhones(snippetText);
          const site = (r.items.find(x => /https?:\/\//i.test(x.link || ''))?.link) || biz.website;
          const updates: any = {};
          if (needEmail && emails.length) updates.email = emails[0];
          if (needPhone && phones.length) updates.phone = phones[0];
          if (needSite && site) updates.website = site;
          if (Object.keys(updates).length) {
            await updateBusinessContacts(biz.id, updates);
            enriched++;
          }
        }
      } catch (e: any) {
        logger.warn('Contact search failed for business', { name: biz.name, error: e?.message || String(e) });
      }
      // brief delay to respect quotas
      await new Promise(r => setTimeout(r, 150));
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, search_id, enriched }) };
  } catch (e: any) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};


