// Enhanced country to GL mapping
const GL_BY_ISO2: Record<string, string> = {
  SA: 'sa',   // Saudi Arabia (PRIORITY)
  ZA: 'za',   // South Africa  
  AE: 'ae', QA: 'qa', KW: 'kw', OM: 'om', BH: 'bh',
  EG: 'eg', TR: 'tr', US: 'us', GB: 'gb', DE: 'de', FR: 'fr',
  CA: 'ca', AU: 'au', JP: 'jp', SG: 'sg', NL: 'nl', CH: 'ch',
  SE: 'se', NO: 'no', IN: 'in', CN: 'cn', BR: 'br', MX: 'mx'
};

export const countryToGL = (country: string): string => {
  const c = (country || '').toLowerCase().trim();
  
  // Handle special case for SA abbreviation - DEFAULT TO SAUDI ARABIA
  if (country.toUpperCase() === 'SA') {
    // SA defaults to Saudi Arabia (original ISO code)
    console.log(`COUNTRY MAPPING DEBUG: SA -> Saudi Arabia (sa)`);
    return 'sa';
  }
  
  // Direct ISO2 lookup first
  const iso2 = country.toUpperCase();
  if (GL_BY_ISO2[iso2]) return GL_BY_ISO2[iso2];
  
  // Fuzzy matching for common variations (order matters - Saudi Arabia ALWAYS first!)
  if (c.includes('saudi arabia') || c.includes('saudi')) return 'sa'; // Saudi Arabia PRIORITY
  // Remove South Africa from fuzzy matching to avoid conflicts with SA
  // South Africa should only be accessible via full name or ZA code
  if (c.includes('emirates') || c.includes('uae')) return 'ae';
  if (c.includes('qatar')) return 'qa';
  if (c.includes('kuwait')) return 'kw';
  if (c.includes('oman')) return 'om';
  if (c.includes('bahrain')) return 'bh';
  if (c.includes('egypt')) return 'eg';
  if (c.includes('turkey')) return 'tr';
  if (c.includes('uk') || c.includes('united kingdom')) return 'gb';
  if (c.includes('united states') || c === 'us' || c === 'usa') return 'us';
  if (c.includes('germany')) return 'de';
  if (c.includes('france')) return 'fr';
  if (c.includes('canada')) return 'ca';
  if (c.includes('australia')) return 'au';
  if (c.includes('japan')) return 'jp';
  if (c.includes('singapore')) return 'sg';
  if (c.includes('netherlands')) return 'nl';
  if (c.includes('switzerland')) return 'ch';
  if (c.includes('sweden')) return 'se';
  if (c.includes('norway')) return 'no';
  if (c.includes('india')) return 'in';
  if (c.includes('china')) return 'cn';
  if (c.includes('brazil')) return 'br';
  if (c.includes('mexico')) return 'mx';
  
  return 'us'; // Default fallback
};

// Reverse mapping: GL code to proper country name
export const glToCountryName = (gl: string): string => {
  const glMap: Record<string, string> = {
    'sa': 'Saudi Arabia',
    'za': 'South Africa',
    'ae': 'United Arab Emirates',
    'qa': 'Qatar',
    'kw': 'Kuwait',
    'om': 'Oman',
    'bh': 'Bahrain',
    'eg': 'Egypt',
    'tr': 'Turkey',
    'us': 'United States',
    'gb': 'United Kingdom',
    'de': 'Germany',
    'fr': 'France',
    'ca': 'Canada',
    'au': 'Australia',
    'jp': 'Japan',
    'sg': 'Singapore',
    'nl': 'Netherlands',
    'ch': 'Switzerland',
    'se': 'Sweden',
    'no': 'Norway',
    'in': 'India',
    'cn': 'China',
    'br': 'Brazil',
    'mx': 'Mexico'
  };
  
  return glMap[gl.toLowerCase()] || gl.toUpperCase();
};

// CSV contact parsing for decision maker discovery
export function parseContactsCSV(csv: string) {
  return csv.trim().split('\n').map(line => {
    const [name, title, email, phone, linkedin] = line.split(',').map(s => s?.trim());
    return { 
      name: name || '', 
      title: title || '', 
      email: email || '', 
      phone: phone || '', 
      linkedin: linkedin || '' 
    };
  }).filter(c => c.name && c.name.length > 2); // Only include contacts with valid names
}

// Safe business data builder with defaults
export function buildBusinessData(params: {
  search_id: string;
  user_id: string;
  persona_id: string;
  name: string;
  industry: string;
  country: string;
  address?: string;
  city?: string;
  size?: string;
  revenue?: string;
  description?: string;
  match_score?: number;
  persona_type?: string;
  relevant_departments?: string[];
  key_products?: string[];
  recent_activity?: string[];
}) {
  // Extract city from address if not provided
  const parsedCity = params.city || extractCityFromAddress(params.address) || null;
  
  return {
    search_id: params.search_id,
    user_id: params.user_id,
    persona_id: params.persona_id,
    name: params.name,
    industry: params.industry,
    country: params.country,
    city: parsedCity,
    size: params.size || null,
    revenue: params.revenue || null,
    description: params.description || params.address || '',
    match_score: params.match_score || 75,
    relevant_departments: params.relevant_departments || [],
    key_products: params.key_products || [],
    recent_activity: params.recent_activity || [],
    persona_type: params.persona_type || 'business'
  };
}

// Simple city extraction from address
function extractCityFromAddress(address?: string): string | null {
  if (!address) return null;
  
  // Simple heuristic: take the first part before comma
  const parts = address.split(',').map(p => p.trim());
  if (parts.length > 1) {
    return parts[0];
  }
  
  return null;
}

// Retry utility with exponential backoff
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries) {
        throw lastError;
      }
      
      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}