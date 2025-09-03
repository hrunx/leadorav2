import { glToCountryName, fetchWithTimeoutRetry, countryToGL } from './util';
import { createClient } from '@supabase/supabase-js';
import logger from '../lib/logger';

// Avoid using import.meta in server bundles; prefer process.env.
// For browser contexts (not expected here), callers should provide values via API.
function getEnvVar(key: string): string | undefined {
  try {
    if (typeof process !== 'undefined' && process.env && typeof process.env[key] === 'string') {
      const v = String(process.env[key] || '').trim();
      if (v) return v;
    }
  } catch {}
  return undefined;
}

// Lightweight in-process limiter for Serper calls
let running = 0;
const queue: Array<() => void> = [];
const MAX_CONCURRENT = Number(getEnvVar('VITE_SERPER_MAX_CONCURRENT') || getEnvVar('SERPER_MAX_CONCURRENT') || '3');
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
const supabaseUrl = getEnvVar('SUPABASE_URL') || getEnvVar('VITE_SUPABASE_URL');
const supabaseKey = getEnvVar('SUPABASE_SERVICE_ROLE_KEY') || getEnvVar('VITE_SUPABASE_SERVICE_ROLE_KEY');
const supa = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession:false, autoRefreshToken:false } })
  : null;

// type CacheEntry = { response: any; ttl_at: string };
const memCache = new Map<string, { value:any; ttl:number }>();
const MAX_CACHE_ENTRIES = Number(getEnvVar('VITE_SERPER_CACHE_MAX') || getEnvVar('SERPER_CACHE_MAX') || '500');
const now = () => Date.now();
const DEFAULT_TTL_MS = Number(getEnvVar('VITE_SERPER_CACHE_TTL_MS') || getEnvVar('SERPER_CACHE_TTL_MS') || String(6*60*60*1000)); // 6h

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

async function setCache(cache_key: string, source: 'serper' | 'google_places', response: any, ttlMs = DEFAULT_TTL_MS) {
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
// Delegate GL mapping to centralized util.countryToGL to avoid divergence
const glFromCountry = (country: string): string => countryToGL(country);

// Deprecated inline timeout function removed; we use fetchWithTimeoutRetry exclusively

export async function serperPlaces(q: string, country: string, limit = 10) {
  return retryWithBackoff(async () => withLimiter(async () => {
    const gl = glFromCountry(country);
    // Strengthen country scoping by injecting the country name directly into the query string
    const countryName = glToCountryName(gl);
    const queryIncludesCountry = (q || '').toLowerCase().includes((country || '').toLowerCase()) || (q || '').toLowerCase().includes(countryName.toLowerCase());
    const qStrict = queryIncludesCountry ? q : `${q} ${countryName}`;
    logger.info('[SERPER] Places query', { q: qStrict, country, gl, limit });
    const cacheKey = `serper:places:${gl}:${limit}:${qStrict}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached.slice(0, limit);
    
    // Validate SERPER_KEY early to avoid runtime crash messages
    const serperKey = getEnvVar('VITE_SERPER_KEY') || getEnvVar('SERPER_KEY');
    if (!serperKey) throw new Error('SERPER_KEY is required');
    
    const r = await fetchWithTimeoutRetry('https://google.serper.dev/places', {
      method: 'POST',
      headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
      // request a bit more and trim after filtering
      body: JSON.stringify({ q: qStrict, gl, num: Math.min(Math.max(limit, 10), 15) })
    }, 10000, 1, 800);
    
    if (!r.ok) {
      const text = await r.text();
      // On quota/auth errors, try Google CSE fallback to at least return company-like results
      const isQuota = r.status === 400 && text && text.toLowerCase().includes('not enough credits');
      const isAuthRate = r.status === 401 || r.status === 403 || r.status === 429;
      if (isQuota || isAuthRate) {
        logger.warn('[SERPER] /places auth/quota error, trying Google Places fallback', { status: r.status, text });
        
        // Try Google Places API as fallback
        try {
          const { googlePlacesTextSearch } = await import('./google-places');
          const placesFromGoogle = await googlePlacesTextSearch(q, gl, Math.min(limit, 10), country);
          if (placesFromGoogle.length > 0) {
            logger.info('[SERPER] Google Places fallback produced results', { count: placesFromGoogle.length });
            await setCache(cacheKey, 'google_places', placesFromGoogle);
            return placesFromGoogle.slice(0, limit);
          }
          logger.warn('[SERPER] Google Places fallback returned 0 results');
        } catch (placesError: any) {
          logger.warn('[SERPER] Google Places fallback error', { error: placesError.message });
        }
        
        // For places searches, only use Google Places API as fallback
        // CSE is for web searches only, not places
        logger.warn('Google Places API fallback failed, no more fallbacks for places');
        return [];
      }
      throw new Error(`SERPER /places ${r.status}: ${text || 'no body'}`);
    }
    
    const data = await r.json();
    // If Serper returns no places, attempt Google Places fallback proactively
    if (!Array.isArray(data?.places) || data.places.length === 0) {
      try {
        const { googlePlacesTextSearch } = await import('./google-places');
        const gp = await googlePlacesTextSearch(qStrict, gl, Math.min(limit, 10), country);
        if (gp.length > 0) {
          logger.debug('Serper /places empty; Google Places fallback produced results', { count: gp.length });
          await setCache(cacheKey, 'google_places', gp);
          return gp.slice(0, limit);
        }
      } catch {}
      // No fallback results; return empty to avoid blocking
      return [];
    }
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
    // Do not apply any post-filtering by country; country is enforced in the upstream query text and GL
    // Cap results to requested limit
    places = places.slice(0, limit);
    
    logger.info('[SERPER] Places final results', { count: places.length, q: qStrict, country });
    await setCache(cacheKey, 'serper', places);
    return places;
  }));
}

export async function serperSearch(q: string, country: string, limit = 5): Promise<{ success: boolean; items: { title: string; link: string; snippet: string }[]; error?: string; status?: number }> {
  return retryWithBackoff(async () => withLimiter(async () => {
    const gl = glFromCountry(country || 'US');
    logger.info('[SERPER] Search query', { q, country, gl, limit });
    const cacheKey = `serper:search:${gl}:${limit}:${q}`;
    const cached = await getCache(cacheKey);
    if (cached) return { success: true, items: cached.slice(0, limit) };

    // Validate SERPER_KEY early to avoid runtime crash messages
    const serperKey = getEnvVar('VITE_SERPER_KEY') || getEnvVar('SERPER_KEY');
    if (!serperKey) throw new Error('SERPER_KEY is required');
    
    const r = await fetchWithTimeoutRetry('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl, num: Math.min(limit, 10) })
    }, 10000, 1, 800);

    if (!r.ok) {
      const text = await r.text();
      // Gracefully degrade on common quota/auth errors and try Google CSE fallback
      const isQuota = r.status === 400 && text && text.toLowerCase().includes('not enough credits');
      const isAuthRate = r.status === 401 || r.status === 403 || r.status === 429;
      if (isQuota || isAuthRate) {
        logger.warn('[SERPER] /search auth/quota error; attempting Google CSE fallback', { status: r.status, q });
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

    logger.info('[SERPER] Search final results', { count: results.length, q, country });
    await setCache(cacheKey, 'serper', results);
    return { success: true, items: results };
  }));
}

// Google Custom Search (CSE) fallback
async function googleCseSearch(q: string, gl: string, limit: number): Promise<{ success: boolean; items: { title: string; link: string; snippet: string }[]; error?: string; status?: number }> {
  try {
    const key = getEnvVar('VITE_GOOGLE_CSE_KEY') || getEnvVar('GOOGLE_CSE_KEY') || getEnvVar('VITE_GOOGLE_API_KEY') || getEnvVar('GOOGLE_API_KEY') || getEnvVar('Google_CSE_KEY');
    const cx = getEnvVar('VITE_GOOGLE_CSE_CX') || getEnvVar('GOOGLE_CSE_CX') || getEnvVar('VITE_GOOGLE_SEARCH_ENGINE_ID') || getEnvVar('GOOGLE_SEARCH_ENGINE_ID') || getEnvVar('Google_CSE_CX');
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
