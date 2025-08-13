/* eslint-env node */
import { MarketInsightsSchema } from './marketInsightsSchema';
import { expect, describe, it } from 'vitest';

const validData = {
  tam_data: { value: '$1B', description: 'Total Addressable Market' },
  sam_data: { value: '$500M', description: 'Serviceable Addressable Market' },
  som_data: { value: '$50M', description: 'Serviceable Obtainable Market' },
  competitor_data: [{ name: 'Comp', marketShare: '10%' }],
  trends: [{ trend: 'Trend', impact: 'High' }],
  opportunities: { summary: 'summary', playbook: [], market_gaps: [], timing: 'now' },
  sources: [{ title: 'Source', url: 'https://example.com' }],
};

describe('MarketInsightsSchema', () => {
  it('validates correct data', () => {
    const result = MarketInsightsSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('rejects missing tam_data', () => {
    const rest: any = { ...validData };
    delete rest.tam_data;
    const result = MarketInsightsSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects invalid competitor_data structure', () => {
    const bad = { ...validData, competitor_data: {} } as any;
    const result = MarketInsightsSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects invalid source URL', () => {
    const bad = { ...validData, sources: [{ title: 'Source', url: 'not-a-url' }] } as any;
    const result = MarketInsightsSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
