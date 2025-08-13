import { loadSearch } from '../tools/db.read';
import { updateSearchProgress, mergeAgentMetadata } from '../tools/db.write';
import logger from '../lib/logger';
import { runBusinessPersonas } from '../agents/business-persona.agent';
import { runDMPersonas } from '../agents/dm-persona.agent';
import { runBusinessDiscovery } from '../agents/business-discovery.agent';
import { runMarketResearch } from '../agents/market-research.agent';
import { runAdvancedMarketResearch } from '../agents/market-research-advanced.agent';

export async function orchestrate(search_id: string, _user_id: string, sendUpdate?: (type: string, data: unknown) => void) {
  logger.info('Starting optimized parallel orchestration', { search_id });

  const updateFn = sendUpdate || (() => {});

  try {
    const search = await loadSearch(search_id);
    const useAdvancedResearch = Boolean((search as any)?.use_advanced_research);

    await updateSearchProgress(search_id, 5, 'starting', 'in_progress');
    updateFn('PROGRESS', { phase: 'starting', progress: 5 });

    // Configure market research task once
    const marketResearchTask = useAdvancedResearch ? runAdvancedMarketResearch : runMarketResearch;

    // Weight-based progress reporting
    const weights = { business_personas: 10, dm_personas: 10, business_discovery: 40, market_research: 20 } as const;
    let currentProgress = 20;
    let chain = Promise.resolve();
    const reportProgress = (weight: number, phase: keyof typeof weights) => {
      chain = chain.then(async () => {
        currentProgress += weight;
        await updateSearchProgress(search_id, currentProgress, phase, 'in_progress');
        updateFn('PROGRESS', { phase, progress: currentProgress });
      });
      return chain;
    };

    // Shared status map for status_detail
    const statusMap: Record<string, 'done' | 'failed'> = {};
    const recordStatus = async (agent: string, outcome: 'done' | 'failed') => {
      statusMap[agent] = outcome;
      try {
        await updateSearchProgress(search_id, currentProgress, 'starting', 'in_progress', statusMap);
      } catch (err: any) {
        logger.warn('Failed to update status_detail', { error: err?.message || err });
      }
    };

    await updateSearchProgress(search_id, 20, 'starting', 'in_progress');
    updateFn('PROGRESS', { phase: 'starting', progress: 20 });

    // Parallel task executions
    const parallelTasks = [
      runBusinessPersonas(search)
        .then(async () => { updateFn('PERSONAS_READY', { type: 'business', search_id }); await recordStatus('business_personas', 'done'); return 'business_personas_done'; })
        .catch(async (err) => { logger.warn('Business personas failed', { error: err?.message || err }); await recordStatus('business_personas', 'failed'); return 'business_personas_failed'; })
        .finally(() => reportProgress(weights.business_personas, 'business_personas')),

      runDMPersonas(search)
        .then(async () => { updateFn('PERSONAS_READY', { type: 'dm', search_id }); await recordStatus('dm_personas', 'done'); return 'dm_personas_done'; })
        .catch(async (err) => { logger.warn('DM personas failed', { error: err?.message || err }); await recordStatus('dm_personas', 'failed'); return 'dm_personas_failed'; })
        .finally(() => reportProgress(weights.dm_personas, 'dm_personas')),

      runBusinessDiscovery(search)
        .then(async () => { updateFn('BUSINESSES_FOUND', { search_id }); await recordStatus('business_discovery', 'done'); return 'business_discovery_done'; })
        .catch(async (err) => { logger.warn('Business discovery failed', { error: err?.message || err }); await recordStatus('business_discovery', 'failed'); return 'business_discovery_failed'; })
        .finally(() => reportProgress(weights.business_discovery, 'business_discovery')),

      marketResearchTask(search)
        .then(async () => { updateFn('MARKET_RESEARCH_READY', { search_id }); await recordStatus('market_research', 'done'); return 'market_research_done'; })
        .catch(async (err) => { logger.warn('Market research failed', { error: err?.message || err }); await mergeAgentMetadata(search_id, { market_research_warning: true }); await recordStatus('market_research', 'failed'); return 'market_research_failed'; })
        .finally(() => reportProgress(weights.market_research, 'market_research')),
    ];

    const results = await Promise.allSettled(parallelTasks);
    results.forEach((result, index) => {
      const taskNames = ['Business Personas', 'DM Personas', 'Business Discovery', useAdvancedResearch ? 'Advanced Market Research' : 'Market Research'];
      if (result.status === 'fulfilled') {
        logger.debug(`${taskNames[index]} finished`, { result: result.value });
      } else {
        logger.warn(`${taskNames[index]} failed`, { error: (result as any).reason });
      }
    });

    const anySuccess = Object.values(statusMap).some(s => s === 'done');
    const allFailed = Object.keys(statusMap).length > 0 && Object.values(statusMap).every(s => s === 'failed');
    if (!allFailed && anySuccess) {
      await updateSearchProgress(search_id, 100, 'completed', 'completed', statusMap);
      updateFn('PROGRESS', { phase: 'completed', progress: 100 });
    } else {
      await updateSearchProgress(search_id, 0, 'failed', 'failed', statusMap);
      updateFn('ERROR', { search_id, message: 'All parallel tasks failed' });
    }

    logger.info('Optimized orchestration finished', { search_id });
    return { success: true, search_id, results: statusMap };
  } catch (error: any) {
    logger.error('Orchestration failed', { search_id, error: error?.message || error });
    try {
      await updateSearchProgress(search_id, 0, 'failed', 'failed');
      updateFn('ERROR', { search_id, message: (error?.message || String(error)) });
    } catch (updateError: any) {
      logger.error('Failed to update search progress on error', { error: updateError?.message || updateError });
    }
    throw error;
  }
}