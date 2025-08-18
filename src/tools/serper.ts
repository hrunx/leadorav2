import { glToCountryName, fetchWithTimeoutRetry } from './util';
import { createClient } from '@supabase/supabase-js';
import logger from '../lib/logger';

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

// Retry wrapper with incremental backoff and logging
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelay = 500
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        logger.warn('Serper retry attempt', { attempt, retries });
      }
      return await fn();
    } catch (error) {
      if (attempt === retries) {
        logger.error('Serper request failed after max retries', { error: (error as any)?.message || error });
        throw error;
      }
      const delay = baseDelay * Math.pow(2, attempt);
      logger.warn('Serper request failed, backing off', { attempt: attempt + 1, delay });
      await new Promise(res => setTimeout(res, delay));
    }
  }
  // Should never reach here
  throw new Error('retryWithBackoff exhausted');
}

// Optional DB-backed cache (response_cache)
const supa = (process.env.VITE_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession:false, autoRefreshToken:false } })
  : null;

// type CacheEntry = { response: any; ttl_at: string };
const memCache = new Map<string, { value:any; ttl:number }>();
const MAX_CACHE_ENTRIES = Number(process.env.SERPER_CACHE_MAX || 500);
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
    // Evict oldest when exceeding max entries
    if (memCache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = Array.from(memCache.entries()).sort((a, b) => a[1].ttl - b[1].ttl)[0]?.[0];
      if (oldestKey) memCache.delete(oldestKey);
    }
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

// Deprecated inline timeout function removed; we use fetchWithTimeoutRetry exclusively

export async function serperPlaces(q: string, country: string, limit = 10) {
  return retryWithBackoff(async () => withLimiter(async () => {
    const gl = glFromCountry(country);
    logger.debug('Serper Places query', { q, country, gl });
    const cacheKey = `serper:places:${gl}:${limit}:${q}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached.slice(0, limit);
    
    // Validate SERPER_KEY early to avoid runtime crash messages
    requireEnv('SERPER_KEY');
    const r = await fetchWithTimeoutRetry('https://google.serper.dev/places', {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_KEY!, 'Content-Type': 'application/json' },
      // request a bit more and trim after filtering
      body: JSON.stringify({ q, gl, num: Math.min(Math.max(limit, 10), 15) })
    }, 10000, 1, 800);
    
    if (!r.ok) {
      const text = await r.text();
      // On quota/auth errors, try Google CSE fallback to at least return company-like results
      const isQuota = r.status === 400 && text && text.toLowerCase().includes('not enough credits');
      const isAuthRate = r.status === 401 || r.status === 403 || r.status === 429;
      if (isQuota || isAuthRate) {
        logger.warn('Serper /places error, attempting Google CSE fallback', { status: r.status, q });
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
          logger.debug('Google CSE fallback produced places', { count: placesFromCse.length });
          return placesFromCse;
        }
        // If fallback failed, return empty array gracefully
        logger.warn('Google CSE fallback returned no results for places');
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
    const preFilterCount = places.length;
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
    // If over-filtered (dropped most results), fallback to top N original unfiltered
    if (places.length < Math.min(3, limit) && preFilterCount > places.length) {
      const relaxed = (data.places || []).slice(0, Math.max(limit, 5)).map((p: any) => ({
        name: p.title || 'Unknown Business',
        address: p.address || '',
        phone: p.phoneNumber || '',
        website: p.website || '',
        rating: p.rating || null,
        city: (p.address?.split(',')?.[0] || country)
      }));
      places = relaxed.slice(0, Math.max(limit, 5));
    }
    // If still no places, attempt Google CSE fallback to synthesize place-like entries
    if (places.length === 0) {
      const fallback = await googleCseSearch(q, gl, Math.min(limit, 10));
      if (fallback.success && fallback.items.length > 0) {
        places = fallback.items.slice(0, limit).map((x: any) => ({
          name: x.title || 'Unknown Business',
          address: x.snippet || '',
          phone: '',
          website: x.link || '',
          rating: null,
          city: country
        }));
      }
    }
    // After filtering, cap to requested limit, but if only 1 remains and we requested 5+, allow up to 8 to improve UX
    const cap = places.length <= 1 && limit >= 5 ? 8 : limit;
    places = places.slice(0, cap);
    
    logger.debug('Serper Places results', { count: places.length, q, country });
    await setCache(cacheKey, 'serper', places);
    return places;
  }));
}

export async function serperSearch(q: string, country: string, limit = 5): Promise<{ success: boolean; items: { title: string; link: string; snippet: string }[]; error?: string; status?: number }> {
  return retryWithBackoff(async () => withLimiter(async () => {
    const gl = glFromCountry(country);
    logger.debug('Serper Search query', { q, country, gl });
    const cacheKey = `serper:search:${gl}:${limit}:${q}`;
    const cached = await getCache(cacheKey);
    if (cached) return { success: true, items: cached.slice(0, limit) };

    // Validate SERPER_KEY early to avoid runtime crash messages
    requireEnv('SERPER_KEY');
    const r = await fetchWithTimeoutRetry('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl, num: Math.min(limit, 10) })
    }, 10000, 1, 800);

    if (!r.ok) {
      const text = await r.text();
      // Gracefully degrade on common quota/auth errors and try Google CSE fallback
      const isQuota = r.status === 400 && text && text.toLowerCase().includes('not enough credits');
      const isAuthRate = r.status === 401 || r.status === 403 || r.status === 429;
      if (isQuota || isAuthRate) {
        logger.warn('Serper /search error, attempting Google CSE fallback', { status: r.status, q });
        const fallback = await googleCseSearch(q, gl, Math.min(limit, 10));
        if (fallback.success) return fallback;
        // If CSE is blocked or keys missing, return empty success so downstream can continue
        if (fallback.status === 403 || fallback.error === 'cse_missing_keys') {
          logger.warn('Google CSE blocked or missing; returning empty results to avoid stalling');
          return { success: true, items: [] };
        }
        return { success: false, items: [], error: isQuota ? 'serper_quota_exceeded' : `serper_error_${r.status}`, status: r.status };
      }
      throw new Error(`SERPER /search ${r.status}: ${text || 'no body'}`);
    }

    const data = await r.json();
    const results = (data.organic || []).slice(0, limit).map((x: any) => ({
      title: x.title, link: x.link, snippet: x.snippet
    }));

    logger.debug('Serper Search results', { count: results.length, q, country });
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
      logger.warn('Google CSE fallback unavailable: missing GOOGLE_CSE_KEY or GOOGLE_CSE_CX');
      return { success: false, items: [], error: 'cse_missing_keys' };
    }
    const params = new URLSearchParams({ key, cx, q, num: String(Math.min(limit, 10)) });
    if (gl) params.append('gl', gl);
    const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
    const r = await fetchWithTimeoutRetry(url, { method: 'GET' }, 10000, 1, 800);
    if (!r.ok) {
      const text = await r.text();
      logger.warn('Google CSE error', { status: r.status, text });
      // Treat API_KEY_SERVICE_BLOCKED as soft-empty success to prevent blocking the app
      if (r.status === 403 && /API_KEY_SERVICE_BLOCKED|PERMISSION_DENIED|Requests to this API/.test(text)) {
        return { success: true, items: [] };
      }
      return { success: false, items: [], error: `cse_error_${r.status}`, status: r.status };
    }
    const j = await r.json();
    const items = (j.items || []).map((x: any) => ({ title: x.title, link: x.link, snippet: x.snippet || '' }));
    logger.debug('Google CSE returned results', { count: items.length });
    return { success: true, items };
  } catch (e: any) {
    logger.error('Google CSE fallback failed', { error: e.message });
    return { success: false, items: [], error: e.message };
  }
}