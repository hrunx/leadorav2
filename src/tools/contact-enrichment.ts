import { fetchWithTimeoutRetry } from './util';

export interface ContactEnrichment {
  email?: string;
  phone?: string;
  verification?: {
    status?: string;
    score?: number;
  };
  source: string;
}

export async function fetchContactEnrichment(name: string, company: string): Promise<ContactEnrichment> {
  const apiKey = process.env.HUNTER_API_KEY;
  const source = 'hunter';
  if (!apiKey) {
    return { source, verification: { status: 'missing_api_key' } };
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
      source,
    };
  } catch (err) {
    console.error('Contact enrichment failed', err);
    return { source, verification: { status: 'error' } };
  }
}
