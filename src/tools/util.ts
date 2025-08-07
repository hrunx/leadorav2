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

// Safe business data builder with defaults - includes all contact fields
export function buildBusinessData(params: {
  search_id: string;
  user_id: string;
  persona_id: string | null;
  name: string;
  industry: string;
  country: string;
  address?: string;
  city?: string;
  phone?: string;
  website?: string;
  rating?: number;
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
    address: params.address || null,
    city: parsedCity,
    phone: params.phone || null,
    website: params.website || null,
    rating: params.rating || null,
    size: params.size || null,
    revenue: params.revenue || null,
    description: params.description || params.name,
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
      // Use crypto.getRandomValues for better randomness in jitter
  const jitterArray = new Uint32Array(1);
  crypto.getRandomValues(jitterArray);
  const jitter = (jitterArray[0] / 0xFFFFFFFF) * 1000; // 0-1000ms jitter
  const delay = baseDelay * Math.pow(2, attempt) + jitter;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

// Build decision maker data with all required fields
export function buildDMData(params: {
  search_id: string;
  user_id: string;
  business_id: string;
  persona_id?: string | null;
  name: string;
  title: string;
  company: string;
  linkedin: string;
  email?: string | null;
  phone?: string | null;
  bio?: string;
  location?: string;
  level?: string;
  department?: string;
  influence?: number;
  enrichment_status?: string;
}) {
  return {
    search_id: params.search_id,
    user_id: params.user_id,
    business_id: params.business_id,
    persona_id: params.persona_id,
    name: params.name,
    title: params.title,
    company: params.company,
    linkedin: params.linkedin,
    email: params.email || null,
    phone: params.phone || null,
    bio: params.bio || '',
    location: params.location || '',
    level: params.level || inferLevel(params.title),
    department: params.department || inferDepartment(params.title),
    influence: params.influence ?? inferInfluence(params.title),
    enrichment_status: params.enrichment_status || 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

// Helper functions for inferring DM attributes
function inferLevel(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('ceo') || t.includes('president') || t.includes('founder')) return 'executive';
  if (t.includes('cto') || t.includes('cfo') || t.includes('cmo')) return 'executive';
  if (t.includes('vp') || t.includes('vice president')) return 'executive';
  if (t.includes('director') || t.includes('head of')) return 'director';
  if (t.includes('manager') || t.includes('lead')) return 'manager';
  return 'individual';
}

function inferInfluence(title: string): number {
  const level = inferLevel(title);
  switch (level) {
    case 'executive': return 95;
    case 'director': return 80;
    case 'manager': return 65;
    default: return 45;
  }
}

function inferDepartment(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('tech') || t.includes('engineer') || t.includes('dev')) return 'Technology';
  if (t.includes('market') || t.includes('sales')) return 'Sales & Marketing';
  if (t.includes('finance') || t.includes('accounting')) return 'Finance';
  if (t.includes('operation') || t.includes('ops')) return 'Operations';
  if (t.includes('hr') || t.includes('people')) return 'Human Resources';
  return 'General Management';
}

/**
 * Smart persona mapping for decision makers
 * Maps DM to most relevant persona based on title, department, and seniority
 */
export function mapDMToPersona(employee: { title?: string; }, dmPersonas: { title?: string; }[]): { title?: string; } | null {
  if (!dmPersonas || dmPersonas.length === 0) return null;
  
  const title = employee.title?.toLowerCase() || '';
  
  // Define role keywords for smart matching
  const roleKeywords = {
    'c-level': ['ceo', 'chief executive', 'cto', 'chief technology', 'cmo', 'chief marketing', 'cfo', 'chief financial', 'chief', 'president'],
    'vp': ['vice president', 'vp', 'senior vice'],
    'director': ['director', 'head of', 'senior director'],
    'manager': ['manager', 'senior manager', 'team lead'],
    'technical': ['engineer', 'developer', 'tech', 'technology', 'cto', 'architect', 'devops'],
    'marketing': ['marketing', 'cmo', 'brand', 'growth', 'digital'],
    'sales': ['sales', 'business development', 'account', 'revenue'],
    'finance': ['finance', 'cfo', 'accounting', 'controller'],
    'operations': ['operations', 'ops', 'supply chain', 'logistics'],
    'hr': ['human resources', 'hr', 'people', 'talent']
  };
  
  // Calculate match scores for each persona
  const personaScores = dmPersonas.map(persona => {
    const personaTitle = persona.title?.toLowerCase() || '';
    let score = 0;
    
    // Match by persona keywords
    for (const [, keywords] of Object.entries(roleKeywords)) {
      const titleMatches = keywords.some(keyword => title.includes(keyword));
      const personaMatches = keywords.some(keyword => personaTitle.includes(keyword));
      
      if (titleMatches && personaMatches) {
        score += 10; // Strong match
      } else if (titleMatches || personaMatches) {
        score += 5; // Partial match
      }
    }
    
    // Boost score for exact keyword matches
    if (personaTitle.includes('c-level') && roleKeywords['c-level'].some(k => title.includes(k))) {
      score += 15;
    }
    if (personaTitle.includes('executive') && (title.includes('vp') || title.includes('director'))) {
      score += 10;
    }
    if (personaTitle.includes('manager') && title.includes('manager')) {
      score += 10;
    }
    
    return { persona, score };
  });
  
  // Return the persona with highest score (minimum threshold of 5)
  const bestMatch = personaScores
    .filter(p => p.score >= 5)
    .sort((a, b) => b.score - a.score)[0];
  
  return bestMatch?.persona || dmPersonas[0]; // Fallback to first persona if no good match
}