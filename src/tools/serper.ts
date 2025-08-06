import { retryWithBackoff } from './util';

// Improved country to GL code mapping
function glFromCountry(country: string): string {
  const m = new Map([
    ['saudi arabia','sa'],['sa','sa'], // SA defaults to Saudi Arabia
    ['south africa','za'],
    ['united arab emirates','ae'],['uae','ae'],
    ['qatar','qa'],['bahrain','bh'],['kuwait','kw'],['oman','om'],
    ['egypt','eg'],['jordan','jo'],['morocco','ma'],['turkey','tr'],
    ['india','in'],['united states','us'],['usa','us'],['uk','gb'],
    ['united kingdom','gb'],['canada','ca'],['germany','de'],['france','fr'],
    ['spain','es'],['italy','it'],['australia','au'],['singapore','sg'],
    ['nigeria','ng'],['kenya','ke'],['ghana','gh'],['ethiopia','et']
  ]);
  const key = (country||'').toLowerCase().trim();
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
  return retryWithBackoff(async () => {
    const gl = glFromCountry(country);
    console.log(`Serper Places query: "${q}" in ${country} (gl: ${gl})`);
    
    const r = await fetchWithTimeout('https://google.serper.dev/places', {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl, num: Math.min(limit, 10) })
    });
    
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`SERPER /places ${r.status}: ${text || 'no body'}`);
    }
    
    const data = await r.json();
    const places = (data.places || []).slice(0, limit).map((p: any) => {
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
    
    console.log(`Found ${places.length} places for query: "${q}" in ${country}`);
    return places;
  });
}

export async function serperSearch(q: string, country: string, limit = 5) {
  return retryWithBackoff(async () => {
    const gl = glFromCountry(country);
    console.log(`Serper Search query: "${q}" in ${country} (gl: ${gl})`);
    
    const r = await fetchWithTimeout('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl, num: Math.min(limit, 10) })
    });
    
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`SERPER /search ${r.status}: ${text || 'no body'}`);
    }
    
    const data = await r.json();
    const results = (data.organic || []).slice(0, limit).map((x: any) => ({
      title: x.title, link: x.link, snippet: x.snippet
    }));
    
    console.log(`Found ${results.length} search results for query: "${q}" in ${country}`);
    return results;
  });
}