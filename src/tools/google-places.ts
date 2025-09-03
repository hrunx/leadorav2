import logger from '../lib/logger';
import { fetchWithTimeoutRetry } from './util';

function readEnv(key: string): string | null {
  try {
    if (typeof process !== 'undefined' && process.env && typeof process.env[key] === 'string' && process.env[key]!.trim() !== '') {
      return process.env[key] as string;
    }
  } catch {}
  return null;
}

function getPlacesKey(): string | null {
  // Prefer a dedicated server key if provided, then fall back to common names
  const keys = [
    'GOOGLE_PLACES_SERVER_KEY',
    'GOOGLE_PLACES_KEY',
    'GOOGLE_API_KEY'
  ];
  for (const k of keys) {
    const v = readEnv(k);
    if (v) return v;
  }
  return null;
}

function extractCity(address?: string): string {
  if (!address) return '';
  const parts = address.split(',').map(p => p.trim());
  if (parts.length > 0) return parts[0];
  return '';
}

export async function googlePlacesTextSearch(q: string, gl: string, limit = 10, fallbackCountry = ''): Promise<Array<{ name: string; address: string; phone: string; website: string; rating: number | null; city: string }>> {
  const key = getPlacesKey();
  if (!key) {
    logger.warn('Google Places key not found; skipping Places fallback');
    return [];
  }

  // Attempt Places API (New) v1 first
  try {
    const v1Url = 'https://places.googleapis.com/v1/places:searchText';
    // Enforce country in the text query to scope results, and also set regionCode
    const countrySuffix = fallbackCountry && !q.toLowerCase().includes(fallbackCountry.toLowerCase()) ? ` ${fallbackCountry}` : '';
    const v1Body = {
      textQuery: `${q}${countrySuffix}`,
      regionCode: (gl || '').toUpperCase(),
    } as any;
    const v1Resp = await fetchWithTimeoutRetry(v1Url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.websiteUri,places.internationalPhoneNumber,places.rating'
      },
      body: JSON.stringify(v1Body)
    }, 9000, 1, 800);
    if (v1Resp.ok) {
      const data: any = await v1Resp.json();
      const places = Array.isArray(data?.places) ? data.places.slice(0, Math.max(10, limit)) : [];
      const mapped = places.map((p: any) => ({
        name: p?.displayName?.text || 'Unknown Business',
        address: p?.formattedAddress || '',
        phone: p?.internationalPhoneNumber || '',
        website: p?.websiteUri || '',
        rating: typeof p?.rating === 'number' ? p.rating : null,
        city: extractCity(p?.formattedAddress) || fallbackCountry
      }));
      if (mapped.length > 0) {
        logger.debug('Google Places v1 text search results', { q, gl, count: mapped.length });
        return mapped.slice(0, limit);
      }
    } else {
      const text = await v1Resp.text();
      logger.warn('Google Places v1 text search error', { status: v1Resp.status, text });
    }
  } catch (e: any) {
    logger.warn('Google Places v1 request failed', { error: e?.message || String(e) });
  }

  // Fallback to legacy Text Search + Details API
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    // Include country name in the query to ensure scoping at source
    const legacyCountrySuffix = fallbackCountry && !q.toLowerCase().includes(fallbackCountry.toLowerCase()) ? ` ${fallbackCountry}` : '';
    url.searchParams.set('query', `${q}${legacyCountrySuffix}`);
    if (gl) url.searchParams.set('region', gl);
    url.searchParams.set('key', key);
    const resp = await fetchWithTimeoutRetry(url.toString(), { method: 'GET' }, 9000, 1, 800);
    if (!resp.ok) {
      const text = await resp.text();
      logger.warn('Google Places text search error', { status: resp.status, text });
      return [];
    }
    const data: any = await resp.json();
    if (!Array.isArray(data?.results) || data.results.length === 0) {
      logger.warn('Google Places legacy text search returned no results', { status: data?.status, error_message: data?.error_message });
      return [];
    }
    const results: any[] = data.results.slice(0, Math.max(10, limit));
    const mapped = results.slice(0, limit).map((r:any) => ({
      name: r.name || 'Unknown Business',
      address: r.formatted_address || '',
      phone: '', // Skip details fetch to reduce latency
      website: '', // Skip details fetch to reduce latency
      rating: typeof r.rating === 'number' ? r.rating : null,
      city: extractCity(r.formatted_address) || fallbackCountry
    }));
    logger.debug('Google Places legacy text search results (no-details)', { q, gl, count: mapped.length });
    return mapped;
  } catch (e: any) {
    logger.warn('Google Places fallback failed', { error: e?.message || String(e) });
    return [];
  }
}


