import { fetchWithTimeoutRetry } from './util';
import { serperSearch } from './serper';
import logger from '../lib/logger';

export interface ContactEnrichment {
  email?: string;
  phone?: string;
  linkedin?: string;
  verification?: {
    status?: string;
    score?: number;
  };
  sources: string[];
  confidence: number;
}

// Hunter.io enrichment
async function fetchFromHunter(name: string, company: string): Promise<Partial<ContactEnrichment>> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) {
    return { sources: ['hunter'], verification: { status: 'missing_api_key' } };
  }
  const url = `https://api.hunter.io/v2/email-finder?full_name=${encodeURIComponent(name)}&company=${encodeURIComponent(company)}&api_key=${apiKey}`;
  try {
    const res = await fetchWithTimeoutRetry(url, { method: 'GET' }, 8000, 2, 800);
    if (!res.ok) {
      throw new Error(`Hunter API error: ${res.status}`);
    }
    const json = await res.json();
    return {
      email: json?.data?.email,
      phone: json?.data?.phone,
      verification: {
        status: json?.data?.verification?.status,
        score: json?.data?.score,
      },
      sources: ['hunter'],
      confidence: json?.data?.score || 50
    };
  } catch (err: any) {
    logger.warn('Hunter enrichment failed', { error: err?.message || String(err) });
    return { sources: ['hunter'], verification: { status: 'error' } };
  }
}

// Serper-based contact discovery
async function fetchFromSerper(name: string, company: string): Promise<Partial<ContactEnrichment>> {
  try {
    const queries = [
      `"${name}" "${company}" email contact`,
      `"${name}" ${company} linkedin profile`,
      `${name} ${company} contact information`,
    ];
    
    let bestResult: Partial<ContactEnrichment> = { sources: ['serper'], confidence: 0 };
    
    for (const query of queries) {
      const result = await serperSearch(query, 'us', 5);
      if (result.success && result.items.length > 0) {
        for (const item of result.items) {
          const text = (item.title + ' ' + item.snippet).toLowerCase();
          
          // Extract email patterns
          const emailMatch = text.match(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/);
          if (emailMatch && !bestResult.email) {
            bestResult.email = emailMatch[0];
            bestResult.confidence = Math.max(bestResult.confidence || 0, 70);
          }
          
          // Extract LinkedIn profile
          if (item.link?.includes('linkedin.com/in/') && !bestResult.linkedin) {
            bestResult.linkedin = item.link;
            bestResult.confidence = Math.max(bestResult.confidence || 0, 80);
          }
          
          // Extract phone patterns (US format)
          const phoneMatch = text.match(/\b(?:\+?1[-.]?)?\(?([0-9]{3})\)?[-.]?([0-9]{3})[-.]?([0-9]{4})\b/);
          if (phoneMatch && !bestResult.phone) {
            bestResult.phone = phoneMatch[0];
            bestResult.confidence = Math.max(bestResult.confidence || 0, 60);
          }
        }
      }
      
      // Break early if we found good contact info
      if (bestResult.email && bestResult.linkedin) break;
    }
    
    return bestResult;
  } catch (err: any) {
    logger.warn('Serper enrichment failed', { error: err?.message || String(err) });
    return { sources: ['serper'], verification: { status: 'error' }, confidence: 0 };
  }
}

export async function fetchContactEnrichment(name: string, company: string): Promise<ContactEnrichment> {
  try {
    // Try multiple sources in parallel
    const [hunterResult, serperResult] = await Promise.allSettled([
      fetchFromHunter(name, company),
      fetchFromSerper(name, company)
    ]);
    
    // Combine results, preferring higher confidence sources
    const combined: ContactEnrichment = {
      sources: [],
      confidence: 0
    };
    
    const results = [];
    if (hunterResult.status === 'fulfilled') results.push(hunterResult.value);
    if (serperResult.status === 'fulfilled') results.push(serperResult.value);
    
    // Merge all sources
    combined.sources = results.flatMap(r => r.sources || []);
    
    // Use best email (highest confidence)
    const emailResults = results.filter(r => r.email);
    if (emailResults.length > 0) {
      const bestEmail = emailResults.reduce((best, current) => 
        (current.confidence || 0) > (best.confidence || 0) ? current : best
      );
      combined.email = bestEmail.email;
      combined.verification = bestEmail.verification;
    }
    
    // Use best phone
    const phoneResults = results.filter(r => r.phone);
    if (phoneResults.length > 0) {
      const bestPhone = phoneResults.reduce((best, current) => 
        (current.confidence || 0) > (best.confidence || 0) ? current : best
      );
      combined.phone = bestPhone.phone;
    }
    
    // Use LinkedIn from any source
    const linkedinResults = results.filter(r => r.linkedin);
    if (linkedinResults.length > 0) {
      combined.linkedin = linkedinResults[0].linkedin;
    }
    
    // Calculate overall confidence
    combined.confidence = Math.max(...results.map(r => r.confidence || 0));
    
    logger.info('Contact enrichment completed', { 
      name, 
      company, 
      sources: combined.sources, 
      hasEmail: !!combined.email, 
      hasPhone: !!combined.phone, 
      hasLinkedIn: !!combined.linkedin,
      confidence: combined.confidence 
    });
    
    return combined;
    
  } catch (err: any) {
    logger.error('Contact enrichment failed completely', { name, company, error: err?.message || String(err) });
    return { 
      sources: ['error'], 
      verification: { status: 'error' }, 
      confidence: 0 
    };
  }
}
