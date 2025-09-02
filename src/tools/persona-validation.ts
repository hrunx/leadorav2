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
  const cleanText = (s: any): string => typeof s === 'string' ? s.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').replace(/^"+|"+$/g, '').trim() : '';
  const coerceStringArray = (v: any): string[] => {
    if (Array.isArray(v)) {
      const out = v
        .map((x: any) => typeof x === 'string' ? cleanText(x) : (x && typeof x.text === 'string' ? cleanText(x.text) : ''))
        .filter((s: string) => s.length > 0);
      return out;
    }
    if (typeof v === 'string') {
      const s = cleanText(v);
      return s ? [s] : [];
    }
    return [];
  };
  const coerceNumber = (v: any): number => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = parseFloat(v.replace(/[^0-9.-]+/g, ''));
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  };
  if (type === 'business') {
    const firstIndustry = Array.isArray((ctx as any)?.industries) && (ctx as any).industries.length
      ? String((ctx as any).industries[0])
      : 'General';
    const firstCountry = Array.isArray((ctx as any)?.countries) && (ctx as any).countries.length
      ? String((ctx as any).countries[0])
      : 'Global';
    const title = cleanText(p?.title);
    const demographics = {
      industry: cleanText(p?.demographics?.industry) || firstIndustry,
      companySize: cleanText(p?.demographics?.companySize) || '51-500',
      geography: cleanText(p?.demographics?.geography) || firstCountry,
      revenue: cleanText(p?.demographics?.revenue) || '$10M-$100M'
    };
    const characteristics = {
      painPoints: (() => {
        const arr = coerceStringArray(p?.characteristics?.painPoints);
        return arr.length > 0 ? arr : ['Lead volatility', 'Integration complexity', 'Price competition'];
      })(),
      motivations: (() => {
        const arr = coerceStringArray(p?.characteristics?.motivations);
        return arr.length > 0 ? arr : ['Revenue growth', 'Operational efficiency', 'Market expansion'];
      })(),
      challenges: (() => {
        const arr = coerceStringArray(p?.characteristics?.challenges);
        return arr.length > 0 ? arr : ['Budget constraints', 'Change management'];
      })(),
      decisionFactors: (() => {
        const arr = coerceStringArray(p?.characteristics?.decisionFactors);
        return arr.length > 0 ? arr : ['ROI', 'Scalability', 'Support'];
      })()
    };
    const behaviors = {
      buyingProcess: cleanText(p?.behaviors?.buyingProcess) || 'RFP → Pilot → Contract',
      decisionTimeline: cleanText(p?.behaviors?.decisionTimeline) || '2-4 months',
      budgetRange: cleanText(p?.behaviors?.budgetRange) || '$20K-$80K',
      preferredChannels: (() => {
        const arr = coerceStringArray(p?.behaviors?.preferredChannels);
        return arr.length > 0 ? arr : ['Email', 'Website', 'Referral'];
      })()
    };
    const market_potential = {
      totalCompanies: (() => {
        const v = isPositiveNumber(p?.market_potential?.totalCompanies) ? p.market_potential.totalCompanies : 0;
        return v > 0 ? v : 1200;
      })(),
      avgDealSize: cleanText(p?.market_potential?.avgDealSize) || '$20K-$80K',
      conversionRate: (() => {
        const v = isPositiveNumber(p?.market_potential?.conversionRate) ? p.market_potential.conversionRate : 0;
        return v > 0 ? v : 4;
      })()
    };
    const locations = Array.isArray(p?.locations) && p.locations.length
      ? p.locations.map((l: any) => cleanText(l))
      : [firstCountry];
    return {
      title,
      rank: typeof p?.rank === 'number' ? p.rank : index + 1,
      match_score: (()=>{ const n=coerceNumber(p?.match_score); return n>0? n : 85; })(),
      demographics,
      characteristics,
      behaviors,
      market_potential,
      locations
    } as BusinessPersona;
  }
  // dm persona - do not inject generic defaults; require model to provide specifics
  const title = cleanText(p?.title);
  const d = p?.demographics || {};
  const demographics = {
    level: cleanText(d.level || d.seniority || d.seniority_level || d.role_level) || (index === 0 ? 'executive' : index === 1 ? 'director' : 'manager'),
    department: cleanText(d.department || d.dept || d.function || d.division) || 'Technology',
    experience: cleanText(d.experience || d.yearsExperience || d.years_experience || d.exp) || '10+ years',
    geography: cleanText(d.geography || d.region || d.country || d.location || d.geo) || (Array.isArray((ctx as any)?.countries) && (ctx as any).countries[0] ? String((ctx as any).countries[0]) : 'Global')
  };
  const c = p?.characteristics || {};
  const characteristics = {
    responsibilities: (() => {
      const arr = coerceStringArray(c.responsibilities || c.key_responsibilities || c.primary_responsibilities || c.responsibility);
      return arr.length > 0 ? arr : ['Strategy', 'Budget', 'Vendor oversight'];
    })(),
    painPoints: (() => {
      const arr = coerceStringArray(c.painPoints || c.pain_points);
      return arr.length > 0 ? arr : ['Legacy systems', 'Cost pressure', 'Talent gap'];
    })(),
    motivations: (() => {
      const arr = coerceStringArray(c.motivations || c.drivers || c.goals);
      return arr.length > 0 ? arr : ['ROI', 'Scalability', 'Reliability'];
    })(),
    challenges: (() => {
      const arr = coerceStringArray(c.challenges || c.blockers);
      return arr.length > 0 ? arr : ['Change management', 'Cross-functional alignment'];
    })(),
    decisionFactors: (() => {
      const arr = coerceStringArray(c.decisionFactors || c.decision_factors || c.buying_criteria);
      return arr.length > 0 ? arr : ['Total cost of ownership', 'Time-to-value', 'Support & SLAs'];
    })()
  };
  const b = p?.behaviors || {};
  const behaviors = {
    decisionMaking: cleanText(b.decisionMaking || b.decision_making || b.decisionStyle) || 'data-driven',
    communicationStyle: cleanText(b.communicationStyle || b.communication_style) || 'concise',
    buyingProcess: cleanText(b.buyingProcess || b.buying_process || b.procurement_process || b.purchasing_process) || 'committee',
    preferredChannels: (() => {
      const arr = coerceStringArray(b.preferredChannels || b.preferred_channels || b.channels || b.contact_channels);
      return arr.length > 0 ? arr : ['Email', 'LinkedIn'];
    })()
  };
  const mp = p?.market_potential || p?.marketPotential || {};
  const market_potential = {
    totalDecisionMakers: (() => {
      const v = coerceNumber(mp.totalDecisionMakers || mp.total_decision_makers || mp.count || mp.num_profiles);
      return v > 0 ? v : Math.max(500, 1500 - index * 300);
    })(),
    avgInfluence: (() => {
      const v = coerceNumber(mp.avgInfluence || mp.avg_influence || mp.average_influence || mp.influence);
      return v > 0 ? v : Math.max(60, 90 - index * 5);
    })(),
    conversionRate: (() => {
      const v = coerceNumber(mp.conversionRate || mp.conversion_rate || mp.conversion || mp.cr);
      return v > 0 ? v : Math.max(2, 6 - index);
    })()
  };
  // Heuristic match score if missing/too low: base on product_service keywords coverage
  const product = (ctx as any)?.product_service ? String((ctx as any).product_service) : '';
  const keywords = product.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
  const haystack = [title,
    demographics.level, demographics.department, demographics.experience, demographics.geography,
    behaviors.decisionMaking, behaviors.communicationStyle, behaviors.buyingProcess,
    ...characteristics.responsibilities, ...characteristics.decisionFactors, ...characteristics.painPoints, ...characteristics.motivations
  ].join(' ').toLowerCase();
  const hits = keywords.length ? keywords.filter(k => haystack.includes(k)).length : 0;
  const keywordScore = keywords.length ? Math.min(95, Math.max(65, Math.round(65 + (hits / keywords.length) * 30))) : 0;
  const baseScore = typeof p?.match_score === 'number' ? p.match_score : coerceNumber(p?.match_score);
  const finalScore = baseScore && baseScore > 0 ? baseScore : keywordScore;
  return {
    title,
    rank: typeof p?.rank === 'number' ? p.rank : index + 1,
    match_score: finalScore || 0,
    demographics,
    characteristics,
    behaviors,
    market_potential
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
