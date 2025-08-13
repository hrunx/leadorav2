import { strict as assert } from 'node:assert';
import { sanitizePersona, isRealisticPersona } from './persona-validation.ts';

const ctx: { industries: string[]; countries: string[]; search_type: 'customer' } = {
  industries: ['Energy'],
  countries: ['USA'],
  search_type: 'customer'
};

// Test sanitizePersona for business
const sanitized = sanitizePersona('business', {}, 0, ctx);
assert.ok(sanitized.title.includes('Buyer Archetype 1'));
assert.equal(sanitized.demographics.industry, 'Energy');
assert.equal(sanitized.locations[0], 'USA');

// Test generic title detection
const genericPersona = {
  title: 'Persona 1',
  rank: 1,
  match_score: 90,
  demographics: { industry: 'Energy', companySize: '100', geography: 'USA', revenue: '$1M' },
  characteristics: { painPoints: ['a'], motivations: ['b'], challenges: ['c'], decisionFactors: ['d'] },
  behaviors: { buyingProcess: 'x', decisionTimeline: 'y', budgetRange: 'z', preferredChannels: ['email'] },
  market_potential: { totalCompanies: 1, avgDealSize: '$1', conversionRate: 1 },
  locations: ['USA']
};
assert.equal(isRealisticPersona('business', genericPersona as any), false);

// Test missing fields for DM persona
const incompleteDM: any = {
  title: 'CTO',
  rank: 1,
  match_score: 90,
  demographics: { level: '', department: '', experience: '', geography: '' },
  characteristics: { responsibilities: [], painPoints: [], motivations: [], challenges: [], decisionFactors: [] },
  behaviors: { decisionMaking: '', communicationStyle: '', buyingProcess: '', preferredChannels: [] },
  market_potential: { totalDecisionMakers: 0, avgInfluence: 0, conversionRate: 0 }
};
assert.equal(isRealisticPersona('dm', incompleteDM), false);

// Test generic DM title
const dmWithGeneric = sanitizePersona('dm', {
  title: 'Persona Manager',
  demographics: { level: 'executive', department: 'IT', experience: '10y', geography: 'USA' },
  characteristics: { responsibilities: ['a'], painPoints: ['b'], motivations: ['c'], challenges: ['d'], decisionFactors: ['e'] },
  behaviors: { decisionMaking: 'Strategic', communicationStyle: 'Brief', buyingProcess: 'Committee', preferredChannels: ['Demos'] },
  market_potential: { totalDecisionMakers: 10, avgInfluence: 5, conversionRate: 1 }
}, 0, ctx);
assert.equal(isRealisticPersona('dm', dmWithGeneric), false);

console.log('persona-validation tests passed');
