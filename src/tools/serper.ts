import { glToCountryName, fetchWithTimeoutRetry, countryToGL } from './util';
import { createClient } from '@supabase/supabase-js';
import logger from '../lib/logger';

function getEnvVar(key: string): string | undefined {
  // Check if we're in a browser environment (client-side)
  if (typeof window !== 'undefined') {
    return import.meta.env[key];
  }
  // Server-side (Netlify functions) - use process.env
  else if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  }
  // Fallback to import.meta.env
  else {
    return import.meta.env?.[key];
  }
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
const supabaseUrl = getEnvVar('VITE_SUPABASE_URL') || getEnvVar('SUPABASE_URL');
const supabaseKey = getEnvVar('VITE_SUPABASE_SERVICE_ROLE_KEY') || getEnvVar('SUPABASE_SERVICE_ROLE_KEY');
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
    logger.debug('Serper Places query', { q, country, gl });
    const cacheKey = `serper:places:${gl}:${limit}:${q}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached.slice(0, limit);
    
    // Validate SERPER_KEY early to avoid runtime crash messages
    const serperKey = getEnvVar('VITE_SERPER_KEY') || getEnvVar('SERPER_KEY');
    if (!serperKey) throw new Error('SERPER_KEY is required');
    
    const r = await fetchWithTimeoutRetry('https://google.serper.dev/places', {
      method: 'POST',
      headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
      // request a bit more and trim after filtering
      body: JSON.stringify({ q, gl, num: Math.min(Math.max(limit, 10), 15) })
    }, 10000, 1, 800);
    
    if (!r.ok) {
      const text = await r.text();
      // On quota/auth errors, try Google CSE fallback to at least return company-like results
      const isQuota = r.status === 400 && text && text.toLowerCase().includes('not enough credits');
      const isAuthRate = r.status === 401 || r.status === 403 || r.status === 429;
      if (isQuota || isAuthRate) {
        console.log('🚨 Serper failed, triggering fallback:', { status: r.status, q, gl, country });
        logger.warn('Serper /places error, attempting Google Places API fallback', { status: r.status, q });
        
        // Try Google Places API as fallback
        try {
          console.log('🔄 Importing Google Places module...');
          const { googlePlacesTextSearch } = await import('./google-places');
          console.log('📍 Calling Google Places API with:', { q, gl, limit: Math.min(limit, 10), country });
          const placesFromGoogle = await googlePlacesTextSearch(q, gl, Math.min(limit, 10), country);
          console.log('📊 Google Places API returned:', { count: placesFromGoogle.length, sample: placesFromGoogle[0] });
          if (placesFromGoogle.length > 0) {
            console.log('✅ Google Places fallback SUCCESS!');
            logger.debug('Google Places API fallback produced places', { count: placesFromGoogle.length });
            await setCache(cacheKey, 'google_places', placesFromGoogle);
            return placesFromGoogle.slice(0, limit);
          }
          console.log('⚠️ Google Places returned 0 results, trying Google CSE');
          logger.warn('Google Places API fallback returned no results, trying Google CSE');
        } catch (placesError: any) {
          console.log('❌ Google Places fallback error:', placesError.message);
          logger.warn('Google Places API fallback failed', { error: placesError.message });
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
        const gp = await googlePlacesTextSearch(q, gl, Math.min(limit, 10), country);
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
    // For places search, we rely only on Serper Places and Google Places API
    // No CSE fallback here - CSE is only for web searches
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
    const gl = glFromCountry(country || 'US');
    logger.debug('Serper Search query', { q, country, gl });
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
