import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureUniqueTitles } from '../business-persona.helpers.ts';

const basePersona = (title: string, rank: number) => ({
  title,
  rank,
  match_score: 90,
  demographics: { industry: 'Tech', companySize: '', geography: '', revenue: '' },
  characteristics: { painPoints: [], motivations: [], challenges: [], decisionFactors: [] },
  behaviors: { buyingProcess: '', decisionTimeline: '', budgetRange: '', preferredChannels: [] },
  market_potential: { totalCompanies: 1, avgDealSize: '', conversionRate: 1 },
  locations: []
});

test('ensureUniqueTitles resolves duplicates and persists distinct titles', async () => {
  const personas = [basePersona('Existing', 1), basePersona('Existing', 2), basePersona('Unique', 3)];
  const refineStub = async () => JSON.stringify({ personas: [{ title: 'Existing' }, { title: 'Existing' }, { title: 'Unique' }] });
  const result = await ensureUniqueTitles(personas, { id: 's1' }, ['Existing'], refineStub);
  const titles = result.map(p => p.title);
  assert.equal(titles.length, 3);
  assert.equal(new Set(titles).size, 3);
});
