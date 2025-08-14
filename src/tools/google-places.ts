import logger from '../lib/logger';

function getPlacesKey(): string | null {
  return process.env.VITE_GOOGLE_PLACES_KEY || (process.env as any).GOOGLE_PLACES_KEY || null;
}

function extractCity(address?: string): string {
  if (!address) return '';
  const parts = address.split(',').map(p => p.trim());
  if (parts.length > 0) return parts[0];
  return '';
}

export async function googlePlacesTextSearch(q: string, gl: string, limit = 10, fallbackCountry = ''): Promise<Array<{ name: string; address: string; phone: string; website: string; rating: number | null; city: string }>> {
  try {
    const key = getPlacesKey();
    if (!key) {
      logger.warn('Google Places key not found; skipping Places fallback');
      return [];
    }
    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    url.searchParams.set('query', q);
    if (gl) url.searchParams.set('region', gl);
    url.searchParams.set('key', key);
    // request more, we will cap later
    const resp = await fetch(url.toString(), { method: 'GET' });
    if (!resp.ok) {
      const text = await resp.text();
      logger.warn('Google Places text search error', { status: resp.status, text });
      return [];
    }
    const data: any = await resp.json();
    const results: any[] = Array.isArray(data?.results) ? data.results.slice(0, Math.max(10, limit)) : [];
    if (results.length === 0) return [];
    // details fetch for top N
    const top = results.slice(0, limit);
    const detailed = await Promise.all(
      top.map(async (r) => {
        let phone = '';
        let website = '';
        try {
          if (r.place_id) {
            const detUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
            detUrl.searchParams.set('place_id', r.place_id);
            detUrl.searchParams.set('fields', 'website,formatted_phone_number');
            detUrl.searchParams.set('key', key);
            const detResp = await fetch(detUrl.toString(), { method: 'GET' });
            if (detResp.ok) {
              const det = await detResp.json();
              phone = det?.result?.formatted_phone_number || '';
              website = det?.result?.website || '';
            }
          }
        } catch {}
        return {
          name: r.name || 'Unknown Business',
          address: r.formatted_address || '',
          phone,
          website,
          rating: typeof r.rating === 'number' ? r.rating : null,
          city: extractCity(r.formatted_address) || fallbackCountry
        };
      })
    );
    logger.debug('Google Places text search results', { q, gl, count: detailed.length });
    return detailed;
  } catch (e: any) {
    logger.warn('Google Places fallback failed', { error: e?.message || String(e) });
    return [];
  }
}


