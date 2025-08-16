export interface SearchContext {
  industries: string[];
  countries: string[];
  search_type: 'customer' | 'supplier';
}

export interface BusinessPersona {
  title: string;
  rank: number;
  match_score: number;
  demographics: {
    industry: string;
    companySize: string;
    geography: string;
    revenue: string;
  };
  characteristics: {
    painPoints: string[];
    motivations: string[];
    challenges: string[];
    decisionFactors: string[];
  };
  behaviors: {
    buyingProcess: string;
    decisionTimeline: string;
    budgetRange: string;
    preferredChannels: string[];
  };
  market_potential: {
    totalCompanies: number;
    avgDealSize: string;
    conversionRate: number;
  };
  locations: string[];
}

export interface DMPersona {
  title: string;
  rank: number;
  match_score: number;
  demographics: {
    level: string;
    department: string;
    experience: string;
    geography: string;
  };
  characteristics: {
    responsibilities: string[];
    painPoints: string[];
    motivations: string[];
    challenges: string[];
    decisionFactors: string[];
  };
  behaviors: {
    decisionMaking: string;
    communicationStyle: string;
    buyingProcess: string;
    preferredChannels: string[];
  };
  market_potential: {
    totalDecisionMakers: number;
    avgInfluence: number;
    conversionRate: number;
  };
}

export type AnyPersona = BusinessPersona | DMPersona;

const genericTitleTerms = ['persona', 'profile', 'archetype'];

export function isGenericTitle(title: string): boolean {
  const t = title?.toLowerCase() || '';
  return genericTitleTerms.some(g => t.includes(g));
}

function isNonEmptyString(v: any): v is string {
  if (typeof v !== 'string') return false;
  const trimmed = v.trim();
  if (trimmed.length === 0) return false;
  const lowered = trimmed.toLowerCase();
  return !['unknown', 'n/a', 'default', 'none'].includes(lowered);
}
function isNonEmptyArray(v: any): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString);
}
function isPositiveNumber(v: any): v is number {
  return typeof v === 'number' && v > 0;
}

export function sanitizePersona(
  type: 'business',
  p: any,
  index: number,
  ctx: SearchContext
): BusinessPersona;
export function sanitizePersona(
  type: 'dm',
  p: any,
  index: number,
  ctx: SearchContext
): DMPersona;
export function sanitizePersona(
  type: 'business' | 'dm',
  p: any,
  index: number,
  ctx: SearchContext
): AnyPersona {
  if (type === 'business') {
    // Drop generator fallbacks; enforce LLM-provided values only
    return {
      title: String(p?.title || ''),
      rank: typeof p?.rank === 'number' ? p.rank : index + 1,
      match_score: typeof p?.match_score === 'number' ? p.match_score : 85,
      demographics: {
        industry: String(p?.demographics?.industry || ''),
        companySize: String(p?.demographics?.companySize || ''),
        geography: String(p?.demographics?.geography || ''),
        revenue: String(p?.demographics?.revenue || '')
      },
      characteristics: {
        painPoints: Array.isArray(p?.characteristics?.painPoints) ? p.characteristics.painPoints : [],
        motivations: Array.isArray(p?.characteristics?.motivations) ? p.characteristics.motivations : [],
        challenges: Array.isArray(p?.characteristics?.challenges) ? p.characteristics.challenges : [],
        decisionFactors: Array.isArray(p?.characteristics?.decisionFactors) ? p.characteristics.decisionFactors : []
      },
      behaviors: {
        buyingProcess: String(p?.behaviors?.buyingProcess || ''),
        decisionTimeline: String(p?.behaviors?.decisionTimeline || ''),
        budgetRange: String(p?.behaviors?.budgetRange || ''),
        preferredChannels: Array.isArray(p?.behaviors?.preferredChannels) ? p.behaviors.preferredChannels : []
      },
      market_potential: {
        totalCompanies: typeof p?.market_potential?.totalCompanies === 'number' ? p.market_potential.totalCompanies : 0,
        avgDealSize: String(p?.market_potential?.avgDealSize || ''),
        conversionRate: typeof p?.market_potential?.conversionRate === 'number' ? p.market_potential.conversionRate : 0
      },
      locations: Array.isArray(p?.locations) ? p.locations : []
    } as BusinessPersona;
  }
  // dm persona - do not inject generic defaults; require model to provide specifics
  return {
    title: String(p?.title || ''),
    rank: typeof p?.rank === 'number' ? p.rank : index + 1,
    match_score: typeof p?.match_score === 'number' ? p.match_score : 0,
    demographics: {
      level: String(p?.demographics?.level || ''),
      department: String(p?.demographics?.department || ''),
      experience: String(p?.demographics?.experience || ''),
      geography: String(p?.demographics?.geography || '')
    },
    characteristics: {
      responsibilities: Array.isArray(p?.characteristics?.responsibilities) ? p.characteristics.responsibilities : [],
      painPoints: Array.isArray(p?.characteristics?.painPoints) ? p.characteristics.painPoints : [],
      motivations: Array.isArray(p?.characteristics?.motivations) ? p.characteristics.motivations : [],
      challenges: Array.isArray(p?.characteristics?.challenges) ? p.characteristics.challenges : [],
      decisionFactors: Array.isArray(p?.characteristics?.decisionFactors) ? p.characteristics.decisionFactors : []
    },
    behaviors: {
      decisionMaking: String(p?.behaviors?.decisionMaking || ''),
      communicationStyle: String(p?.behaviors?.communicationStyle || ''),
      buyingProcess: String(p?.behaviors?.buyingProcess || ''),
      preferredChannels: Array.isArray(p?.behaviors?.preferredChannels) ? p.behaviors.preferredChannels : []
    },
    market_potential: {
      totalDecisionMakers: typeof p?.market_potential?.totalDecisionMakers === 'number'
        ? p.market_potential.totalDecisionMakers
        : 0,
      avgInfluence: typeof p?.market_potential?.avgInfluence === 'number' ? p.market_potential.avgInfluence : 0,
      conversionRate: typeof p?.market_potential?.conversionRate === 'number' ? p.market_potential.conversionRate : 0
    }
  } as DMPersona;
}

export function isRealisticPersona(type: 'business', persona: BusinessPersona): boolean;
export function isRealisticPersona(type: 'dm', persona: DMPersona): boolean;
export function isRealisticPersona(type: 'business' | 'dm', persona: AnyPersona): boolean {
  if (!persona || !isNonEmptyString((persona as any).title) || isGenericTitle((persona as any).title)) return false;
  if (typeof (persona as any).rank !== 'number' || (persona as any).rank < 1 || (persona as any).rank > 5) return false;
  if (typeof (persona as any).match_score !== 'number' || (persona as any).match_score < 60) return false;

  if (type === 'business') {
    const p = persona as BusinessPersona;
    const d = p.demographics;
    if (!d || !isNonEmptyString(d.industry) || !isNonEmptyString(d.companySize) || !isNonEmptyString(d.geography) || !isNonEmptyString(d.revenue)) return false;
    const c = p.characteristics;
    if (!c || !isNonEmptyArray(c.painPoints) || !isNonEmptyArray(c.motivations) || !isNonEmptyArray(c.challenges) || !isNonEmptyArray(c.decisionFactors)) return false;
    const b = p.behaviors;
    if (!b || !isNonEmptyString(b.buyingProcess) || !isNonEmptyString(b.decisionTimeline) || !isNonEmptyString(b.budgetRange) || !isNonEmptyArray(b.preferredChannels)) return false;
    const m = p.market_potential;
    if (!m || !isPositiveNumber(m.totalCompanies) || !isNonEmptyString(m.avgDealSize) || !isPositiveNumber(m.conversionRate)) return false;
    if (!isNonEmptyArray(p.locations)) return false;
    return true;
  }
  const p = persona as DMPersona;
  const d = p.demographics;
  if (!d || !isNonEmptyString(d.level) || !isNonEmptyString(d.department) || !isNonEmptyString(d.experience) || !isNonEmptyString(d.geography)) return false;
  const c = p.characteristics;
  if (!c || !isNonEmptyArray(c.responsibilities) || !isNonEmptyArray(c.painPoints) || !isNonEmptyArray(c.motivations) || !isNonEmptyArray(c.challenges) || !isNonEmptyArray(c.decisionFactors)) return false;
  const b = p.behaviors;
  if (!b || !isNonEmptyString(b.decisionMaking) || !isNonEmptyString(b.communicationStyle) || !isNonEmptyString(b.buyingProcess) || !isNonEmptyArray(b.preferredChannels)) return false;
  const m = p.market_potential;
  if (!m || !isPositiveNumber(m.totalDecisionMakers) || !isPositiveNumber(m.avgInfluence) || !isPositiveNumber(m.conversionRate)) return false;
  return true;
}
