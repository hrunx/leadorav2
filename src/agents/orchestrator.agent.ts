import { Agent, tool, run } from '@openai/agents';
import logger from '../lib/logger';

const startBusinessDiscovery = tool({
  name: 'startBusinessDiscovery',
  description: 'Start business discovery for the given search.',
  parameters: {
    type: 'object',
    properties: { search_id: { type: 'string' }, user_id: { type: 'string' } },
    required: ['search_id','user_id'],
    additionalProperties: false
  } as const,
  strict: true,
  execute: async (input: any) => {
    const { execBusinessDiscovery } = await import('../orchestration/exec-business-discovery');
    await execBusinessDiscovery({ search_id: String(input.search_id), user_id: String(input.user_id) });
    return { ok: true } as const;
  }
});

const startBusinessPersonas = tool({
  name: 'startBusinessPersonas',
  description: 'Generate and store exactly 3 business personas.',
  parameters: {
    type: 'object',
    properties: { search_id: { type: 'string' }, user_id: { type: 'string' } },
    required: ['search_id','user_id'],
    additionalProperties: false
  } as const,
  strict: true,
  execute: async (input: any) => {
    const { execBusinessPersonas } = await import('../orchestration/exec-business-personas');
    await execBusinessPersonas({ search_id: String(input.search_id), user_id: String(input.user_id) });
    return { ok: true } as const;
  }
});

const startDMPersonas = tool({
  name: 'startDMPersonas',
  description: 'Generate and store exactly 3 decision-maker personas.',
  parameters: {
    type: 'object',
    properties: { search_id: { type: 'string' }, user_id: { type: 'string' } },
    required: ['search_id','user_id'],
    additionalProperties: false
  } as const,
  strict: true,
  execute: async (input: any) => {
    const { execDMPersonas } = await import('../orchestration/exec-dm-personas');
    await execDMPersonas({ search_id: String(input.search_id), user_id: String(input.user_id) });
    return { ok: true } as const;
  }
});

const startMarketResearch = tool({
  name: 'startMarketResearch',
  description: 'Run market research and store insights via agent.',
  parameters: {
    type: 'object',
    properties: { search_id: { type: 'string' }, user_id: { type: 'string' } },
    required: ['search_id','user_id'],
    additionalProperties: false
  } as const,
  strict: true,
  execute: async (input: any) => {
    const { execMarketResearchParallel } = await import('../orchestration/exec-market-research-parallel');
    await execMarketResearchParallel({ search_id: String(input.search_id), user_id: String(input.user_id) });
    return { ok: true } as const;
  }
});

export const OrchestratorAgent = new Agent({
  name: 'MainOrchestratorAgent',
  tools: [startBusinessPersonas, startDMPersonas, startBusinessDiscovery, startMarketResearch],
  model: 'gpt-4o-mini',
  handoffDescription: 'Coordinates sub-agents to complete a search run',
  handoffs: [],
  instructions: `You orchestrate the entire search pipeline. Steps:
1) Call startBusinessPersonas once.
2) Call startDMPersonas once.
3) Call startBusinessDiscovery once.
4) Call startMarketResearch once.
Do not repeat tools. Do not output anything.`,
});

export async function runOrchestratorAgent(params: { search_id: string; user_id: string }) {
  const msg = `search_id=${params.search_id} user_id=${params.user_id}`;
  await run(OrchestratorAgent, msg);
}


