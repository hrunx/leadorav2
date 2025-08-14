import { describe, it, expect } from 'vitest';
import { sanitizePersona, isRealisticPersona } from './persona-validation.ts';

const ctx: { industries: string[]; countries: string[]; search_type: 'customer' } = {
  industries: ['Energy'],
  countries: ['USA'],
  search_type: 'customer'
};

describe('persona validation helpers', () => {
  it('sanitizes business persona data', () => {
    const sanitized = sanitizePersona('business', {}, 0, ctx);
    expect(sanitized.title).toContain('Buyer Archetype 1');
    expect(sanitized.demographics.industry).toBe('Energy');
    expect(sanitized.locations[0]).toBe('USA');
  });

  it('detects generic business personas', () => {
    const genericPersona = {
      title: 'Persona 1',
      rank: 1,
      match_score: 90,
      demographics: { industry: 'Energy', companySize: '100', geography: 'USA', revenue: '$1M' },
      characteristics: { painPoints: ['a'], motivations: ['b'], challenges: ['c'], decisionFactors: ['d'] },
      behaviors: { buyingProcess: 'x', decisionTimeline: 'y', budgetRange: 'z', preferredChannels: ['email'] },
      market_potential: { totalCompanies: 1, avgDealSize: '$1', conversionRate: 1 },
      locations: ['USA']
    } as any;
    expect(isRealisticPersona('business', genericPersona)).toBe(false);
  });

  it('flags incomplete DM personas', () => {
    const incompleteDM: any = {
      title: 'CTO',
      rank: 1,
      match_score: 90,
      demographics: { level: '', department: '', experience: '', geography: '' },
      characteristics: { responsibilities: [], painPoints: [], motivations: [], challenges: [], decisionFactors: [] },
      behaviors: { decisionMaking: '', communicationStyle: '', buyingProcess: '', preferredChannels: [] },
      market_potential: { totalDecisionMakers: 0, avgInfluence: 0, conversionRate: 0 }
    };
    expect(isRealisticPersona('dm', incompleteDM)).toBe(false);
  });

  it('detects generic DM titles', () => {
    const dmWithGeneric = sanitizePersona('dm', {
      title: 'Persona Manager',
      demographics: { level: 'executive', department: 'IT', experience: '10y', geography: 'USA' },
      characteristics: { responsibilities: ['a'], painPoints: ['b'], motivations: ['c'], challenges: ['d'], decisionFactors: ['e'] },
      behaviors: { decisionMaking: 'Strategic', communicationStyle: 'Brief', buyingProcess: 'Committee', preferredChannels: ['Demos'] },
      market_potential: { totalDecisionMakers: 10, avgInfluence: 5, conversionRate: 1 }
    } as any, 0, ctx);
    expect(isRealisticPersona('dm', dmWithGeneric)).toBe(false);
  });
});

