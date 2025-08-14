import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { serperPlaces, serperSearch } from '../../src/tools/serper';
import { googlePlacesTextSearch } from '../../src/tools/google-places';
import { countryToGL, buildBusinessData } from '../../src/tools/util';
import { insertBusinesses } from '../../src/tools/db.write';

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, apikey, X-Requested-With',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  } as const;
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  try {
    const { search_id, insert } = JSON.parse(event.body || '{}');
    if (!search_id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'search_id required' }) };

    const supa = createClient(
      process.env.VITE_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: search, error } = await supa
      .from('user_searches')
      .select('id,user_id,product_service,industries,countries,search_type')
      .eq('id', search_id)
      .single();
    if (error || !search) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'search_not_found' }) };

    const country: string = (Array.isArray(search.countries) && search.countries[0]) || 'United States';
    const industry: string = (Array.isArray(search.industries) && search.industries[0]) || '';
    const gl = countryToGL(country);
    const q1 = `${search.product_service} ${industry} ${country}`.trim();
    const q2 = `${search.product_service} company ${country}`.trim();

    const [sp1, gp1, cse1] = await Promise.all([
      serperPlaces(q1, country, 10).catch(() => [] as any[]),
      googlePlacesTextSearch(q1, gl, 10, country).catch(() => [] as any[]),
      serperSearch(q1, country, 10).catch(() => ({ success: false, items: [] as any[] }))
    ]);
    const [sp2, gp2, cse2] = await Promise.all([
      serperPlaces(q2, country, 10).catch(() => [] as any[]),
      googlePlacesTextSearch(q2, gl, 10, country).catch(() => [] as any[]),
      serperSearch(q2, country, 10).catch(() => ({ success: false, items: [] as any[] }))
    ]);

    const cseItems = [...(cse1.success ? cse1.items : []), ...(cse2.success ? cse2.items : [])]
      .map((x: any) => ({
        name: x.title || 'Unknown Business',
        address: x.snippet || '',
        phone: '',
        website: x.link || '',
        rating: null,
        city: country
      }));

    const candidates = [
      ...sp1, ...sp2,
      ...gp1, ...gp2,
      ...cseItems
    ];

    // Dedup by website/phone/name+country
    const seenWeb = new Set<string>();
    const seenPhone = new Set<string>();
    const seenNameCountry = new Set<string>();
    const unique = candidates.filter((p: any) => {
      const w = String(p.website || '').toLowerCase();
      const ph = String(p.phone || '').toLowerCase();
      const key = `${String(p.name||'').toLowerCase()}|${country.toLowerCase()}`;
      if (w && seenWeb.has(w)) return false;
      if (ph && seenPhone.has(ph)) return false;
      if (seenNameCountry.has(key)) return false;
      if (w) seenWeb.add(w);
      if (ph) seenPhone.add(ph);
      seenNameCountry.add(key);
      return true;
    }).slice(0, 10);

    let insertedCount = 0;
    if (insert) {
      const rows = unique.slice(0, 8).map((p: any) => buildBusinessData({
        search_id: search.id,
        user_id: search.user_id,
        persona_id: null,
        name: p.name,
        industry: industry || 'General',
        country,
        address: p.address || '',
        city: p.city || country,
        phone: p.phone || undefined,
        website: p.website || undefined,
        rating: typeof p.rating === 'number' ? p.rating : undefined,
        size: 'Unknown',
        revenue: 'Unknown',
        description: 'Business discovered via debug discovery',
        match_score: 80,
        persona_type: 'business_candidate',
        relevant_departments: [],
        key_products: [],
        recent_activity: []
      }));
      try {
        const inserted = await insertBusinesses(rows as any);
        insertedCount = (inserted || []).length;
      } catch (e: any) {
        return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e?.message || String(e) }) };
      }
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true,
        country,
        queries: [q1, q2],
        counts: {
          serper_places_q1: sp1.length,
          google_places_q1: gp1.length,
          cse_q1: (cse1.success ? cse1.items.length : 0),
          serper_places_q2: sp2.length,
          google_places_q2: gp2.length,
          cse_q2: (cse2.success ? cse2.items.length : 0),
          unique: unique.length,
          inserted: insertedCount
        }
      })
    };
  } catch (e: any) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};


