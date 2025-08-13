import { jest } from '@jest/globals';

jest.mock('@openai/agents', () => ({ Agent: class {}, tool: () => ({}) }));
jest.mock('../tools/db.write', () => ({
  insertDMPersonas: jest.fn(() => Promise.resolve()),
  updateSearchProgress: jest.fn(() => Promise.resolve())
}));
jest.mock('./clients', () => ({
  resolveModel: jest.fn(() => 'model'),
  callOpenAIChatJSON: jest.fn(),
  callGeminiText: jest.fn(),
  callDeepseekChatJSON: jest.fn()
}));

let runDMPersonas: any;
let insertDMPersonas: any;
let updateSearchProgress: any;
let callOpenAIChatJSON: any;

beforeAll(async () => {
  ({ runDMPersonas } = await import('./dm-persona.agent'));
  ({ insertDMPersonas, updateSearchProgress } = await import('../tools/db.write'));
  ({ callOpenAIChatJSON } = await import('./clients'));
});

const basePersona = {
  title: 'IT Manager',
  rank: 1,
  match_score: 90,
  demographics: { level: 'manager', department: 'IT', experience: '10 years', geography: 'US' },
  characteristics: {
    responsibilities: ['Oversee systems'],
    painPoints: [''],
    motivations: [''],
    challenges: [''],
    decisionFactors: ['cost']
  },
  behaviors: { decisionMaking: '', communicationStyle: '', buyingProcess: '', preferredChannels: [] as string[] },
  market_potential: { totalDecisionMakers: 100, avgInfluence: 50, conversionRate: 5 }
};

const refinedPersona = {
  ...basePersona,
  characteristics: {
    ...basePersona.characteristics,
    responsibilities: ['Oversee CRM software implementation'],
    decisionFactors: ['CRM integration']
  }
};

describe('ensure product keyword refinement', () => {
  it('injects product keywords when missing', async () => {
    const mockChat: any = callOpenAIChatJSON;
    mockChat
      .mockResolvedValueOnce(JSON.stringify({ personas: [basePersona, basePersona, basePersona] }))
      .mockResolvedValueOnce(JSON.stringify({ personas: [refinedPersona, refinedPersona, refinedPersona] }));

    await runDMPersonas({
      id: '1',
      user_id: 'u1',
      product_service: 'CRM software',
      industries: ['Tech'],
      countries: ['USA'],
      search_type: 'customer'
    });

    const rows = (insertDMPersonas as jest.Mock).mock.calls[0][0] as any[];
    for (const p of rows) {
      const text = [...p.characteristics.responsibilities, ...p.characteristics.decisionFactors].join(' ').toLowerCase();
      expect(text).toMatch(/crm|software/);
    }
    expect(callOpenAIChatJSON).toHaveBeenCalledTimes(2);
    expect(updateSearchProgress).toHaveBeenCalled();
  });
});
