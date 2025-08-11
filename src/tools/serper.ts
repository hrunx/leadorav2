import { retryWithBackoff } from './util';
import { glToCountryName } from './util';
import { createClient } from '@supabase/supabase-js';

function requireEnv(key: string) {
  const v = process.env[key];
  if (!v || v.trim() === '') throw new Error(`${key} is required`);
  return v;
}

// Lightweight in-process limiter for Serper calls
let running = 0;
const queue: Array<() => void> = [];
const MAX_CONCURRENT = Number(process.env.SERPER_MAX_CONCURRENT || 3);
async function withLimiter<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const runNext = async () => {
      running++;
      try { resolve(await fn()); }
      catch (e) { reject(e); }
      finally {
        running--;
        const next = queue.shift();
        if (next) next();
      }
    };
    if (running < MAX_CONCURRENT) runNext(); else queue.push(runNext);
  });
}

// Optional DB-backed cache (response_cache)
const supa = (process.env.VITE_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession:false, autoRefreshToken:false } })
  : null;

// type CacheEntry = { response: any; ttl_at: string };
const memCache = new Map<string, { value:any; ttl:number }>();
const now = () => Date.now();
const DEFAULT_TTL_MS = Number(process.env.SERPER_CACHE_TTL_MS || 6*60*60*1000); // 6h

async function getCache(cache_key: string): Promise<any|null> {
  try {
    const inMem = memCache.get(cache_key);
    if (inMem && inMem.ttl > now()) return inMem.value;
    if (!supa) return null;
    const { data, error } = await supa
      .from('response_cache')
      .select('response, ttl_at')
      .eq('cache_key', cache_key)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (error) return null;
    if (!data) return null;
    if (new Date(data.ttl_at).getTime() < now()) return null;
    memCache.set(cache_key, { value: data.response, ttl: new Date(data.ttl_at).getTime() });
    return data.response;
  } catch { return null; }
}

async function setCache(cache_key: string, source: 'serper', response: any, ttlMs = DEFAULT_TTL_MS) {
  try {
    const expires = new Date(now() + ttlMs).toISOString();
    memCache.set(cache_key, { value: response, ttl: now() + ttlMs });
    if (!supa) return;
    await supa.from('response_cache').insert({
      cache_key,
      source,
      response,
      ttl_at: expires
    });
  } catch {}
}
// Improved country to GL code mapping
function glFromCountry(country: string): string {
  const key = (country || '').toLowerCase().trim();
  const m = new Map<string, string>([
    // Saudi Arabia (SA reserved for KSA)
    ['sa', 'sa'],
    ['ksa', 'sa'],
    ['saudi arabia', 'sa'],
    ['kingdom of saudi arabia', 'sa'],
    // South Africa supported only by explicit names/codes (no 'sa' alias)
    ['south africa', 'za'],
    ['za', 'za'],
    ['rsa', 'za'],
    // GCC and others
    ['united arab emirates', 'ae'], ['uae', 'ae'],
    ['qatar', 'qa'], ['bahrain', 'bh'], ['kuwait', 'kw'], ['oman', 'om'],
    ['egypt', 'eg'], ['jordan', 'jo'], ['morocco', 'ma'], ['turkey', 'tr'],
    // Global
    ['india', 'in'], ['united states', 'us'], ['usa', 'us'],
    ['uk', 'gb'], ['united kingdom', 'gb'], ['canada', 'ca'],
    ['germany', 'de'], ['france', 'fr'], ['spain', 'es'], ['italy', 'it'],
    ['australia', 'au'], ['singapore', 'sg'], ['nigeria', 'ng'],
    ['kenya', 'ke'], ['ghana', 'gh'], ['ethiopia', 'et']
  ]);
  return m.get(key) || 'us';
}

// Timeout utility for fetch requests
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function serperPlaces(q: string, country: string, limit = 10) {
  return retryWithBackoff(async () => withLimiter(async () => {
    const gl = glFromCountry(country);
    console.log(`Serper Places query: "${q}" in ${country} (gl: ${gl})`);
    const cacheKey = `serper:places:${gl}:${limit}:${q}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached.slice(0, limit);
    
    // Validate SERPER_KEY early to avoid runtime crash messages
    requireEnv('SERPER_KEY');
    const r = await fetchWithTimeout('https://google.serper.dev/places', {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_KEY!, 'Content-Type': 'application/json' },
      // request a bit more and trim after filtering
      body: JSON.stringify({ q, gl, num: Math.min(Math.max(limit, 10), 15) })
    });
    
    if (!r.ok) {
      const text = await r.text();
      // On quota/auth errors, try Google CSE fallback to at least return company-like results
      const isQuota = r.status === 400 && text && text.toLowerCase().includes('not enough credits');
      const isAuthRate = r.status === 401 || r.status === 403 || r.status === 429;
      if (isQuota || isAuthRate) {
        console.warn(`Serper error ${r.status} for /places. Attempting Google CSE fallback. Query="${q}"`);
        const fallback = await googleCseSearch(q, gl, Math.min(limit, 10));
        if (fallback.success && fallback.items.length > 0) {
          const placesFromCse = fallback.items.slice(0, limit).map((x: any) => ({
            name: x.title || 'Unknown Business',
            address: x.snippet || '',
            phone: '',
            website: x.link || '',
            rating: null,
            city: country
          }));
          console.log(`Google CSE fallback produced ${placesFromCse.length} place-like results.`);
          return placesFromCse;
        }
        // If fallback failed, return empty array gracefully
        console.warn('Google CSE fallback returned no results for places.');
        return [];
      }
      throw new Error(`SERPER /places ${r.status}: ${text || 'no body'}`);
    }
    
    const data = await r.json();
      let places = (data.places || []).slice(0, limit).map((p: any) => {
      // Extract city from address
      let city = '';
      if (p.address) {
        const addressParts = p.address.split(',').map((part: string) => part.trim());
        // Usually the city is the first or second part
        if (addressParts.length > 1) {
          city = addressParts[0];
        }
      }
      
      return {
        name: p.title || 'Unknown Business',
        address: p.address || '',
        phone: p.phoneNumber || '',
        website: p.website || '',
        rating: p.rating || null,
        city: city || country // Fallback to country if city not found
      };
    });

    // Conservative country filter: allow when address/city clearly match or when site ccTLD matches.
    // For KSA and some markets, addresses often omit country; allow items with empty address but strong ccTLD.
    const countryName = glToCountryName(gl).toLowerCase();
    const ccTld = `.${gl}`;
    places = places.filter((pl: any) => {
      const addr = (pl.address || '').toLowerCase();
      const city = (pl.city || '').toLowerCase();
      const site = (pl.website || '').toLowerCase();
      const hasCountrySignal = addr.includes(countryName) || city.includes(countryName);
      const hasCcTld = site.endsWith(ccTld) || site.includes(`${ccTld}/`);
      // Relax filtering for KSA where addresses/sites often omit country or ccTLD
      if (gl === 'sa') return true;
      // Allow if either clear country signal or ccTLD. Keep US as relaxed.
      return hasCountrySignal || hasCcTld || gl === 'us';
    });
    // After filtering, cap to requested limit, but if only 1 remains and we requested 5+, allow up to 8 to improve UX
    const cap = places.length <= 1 && limit >= 5 ? 8 : limit;
    places = places.slice(0, cap);
    
    console.log(`Found ${places.length} places for query: "${q}" in ${country}`);
    await setCache(cacheKey, 'serper', places);
    return places;
  }));
}

export async function serperSearch(q: string, country: string, limit = 5): Promise<{ success: boolean; items: { title: string; link: string; snippet: string }[]; error?: string; status?: number }> {
  return retryWithBackoff(async () => withLimiter(async () => {
    const gl = glFromCountry(country);
    console.log(`Serper Search query: "${q}" in ${country} (gl: ${gl})`);
    const cacheKey = `serper:search:${gl}:${limit}:${q}`;
    const cached = await getCache(cacheKey);
    if (cached) return { success: true, items: cached.slice(0, limit) };

    // Validate SERPER_KEY early to avoid runtime crash messages
    requireEnv('SERPER_KEY');
    const r = await fetchWithTimeout('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl, num: Math.min(limit, 10) })
    });

    if (!r.ok) {
      const text = await r.text();
      // Gracefully degrade on common quota/auth errors and try Google CSE fallback
      const isQuota = r.status === 400 && text && text.toLowerCase().includes('not enough credits');
      const isAuthRate = r.status === 401 || r.status === 403 || r.status === 429;
      if (isQuota || isAuthRate) {
        console.warn(`Serper error ${r.status} for /search. Attempting Google CSE fallback. Query="${q}"`);
        const fallback = await googleCseSearch(q, gl, Math.min(limit, 10));
        if (fallback.success) return fallback;
        return { success: false, items: [], error: isQuota ? 'serper_quota_exceeded' : `serper_error_${r.status}`, status: r.status };
      }
      throw new Error(`SERPER /search ${r.status}: ${text || 'no body'}`);
    }

    const data = await r.json();
    const results = (data.organic || []).slice(0, limit).map((x: any) => ({
      title: x.title, link: x.link, snippet: x.snippet
    }));

    console.log(`Found ${results.length} search results for query: "${q}" in ${country}`);
    await setCache(cacheKey, 'serper', results);
    return { success: true, items: results };
  }));
}

// Google Custom Search (CSE) fallback
async function googleCseSearch(q: string, gl: string, limit: number): Promise<{ success: boolean; items: { title: string; link: string; snippet: string }[]; error?: string; status?: number }> {
  try {
    const key = process.env.GOOGLE_CSE_KEY || process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CSE_CX || (process.env as any).Google_CSE_CX || process.env.GOOGLE_SEARCH_ENGINE_ID;
    if (!key || !cx) {
      console.warn('Google CSE fallback unavailable: missing GOOGLE_CSE_KEY or GOOGLE_CSE_CX');
      return { success: false, items: [], error: 'cse_missing_keys' };
    }
    const params = new URLSearchParams({ key, cx, q, num: String(Math.min(limit, 10)) });
    if (gl) params.append('gl', gl);
    const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
    const r = await fetchWithTimeout(url, { method: 'GET' }, 10000);
    if (!r.ok) {
      const text = await r.text();
      console.warn(`Google CSE error ${r.status}: ${text}`);
      return { success: false, items: [], error: `cse_error_${r.status}`, status: r.status };
    }
    const j = await r.json();
    const items = (j.items || []).map((x: any) => ({ title: x.title, link: x.link, snippet: x.snippet || '' }));
    console.log(`Google CSE returned ${items.length} results.`);
    return { success: true, items };
  } catch (e: any) {
    console.error('Google CSE fallback failed:', e.message);
    return { success: false, items: [], error: e.message };
  }
}