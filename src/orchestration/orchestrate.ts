import { loadSearch } from '../tools/db.read';
import { updateSearchProgress } from '../tools/db.write';
import logger from '../lib/logger';
import { runBusinessPersonas } from '../agents/business-persona.agent';
import { runDMPersonas } from '../agents/dm-persona.agent';
import { runBusinessDiscovery } from '../agents/business-discovery.agent';
import { runMarketResearch } from '../agents/market-research.agent';

export async function orchestrate(search_id: string, _user_id: string, sendUpdate?: (type: string, data: unknown) => void) {
  logger.info('Starting optimized parallel orchestration', { search_id });

  // Default no-op update function if not provided
  const updateFn = sendUpdate || (() => {});

  try {
    const search = await loadSearch(search_id);
    
    // Initialize progress
    await updateSearchProgress(search_id, 5, 'starting', 'in_progress');
    updateFn('PROGRESS', { phase: 'starting', progress: 5 });

    // 🚀 PHASE 1: Launch ALL agents in parallel immediately
    logger.debug('Launching all agents in parallel');

    
    const statusMap: Record<string, 'done' | 'failed'> = {};
    const recordStatus = async (agent: string, outcome: 'done' | 'failed') => {
      statusMap[agent] = outcome;
      try {
        await updateSearchProgress(search_id, 0, 'starting', 'in_progress', statusMap);
      } catch (err: any) {
        logger.warn('Failed to update status_detail', { error: err?.message || err });
      }



    const weights = {
      business_personas: 10,
      dm_personas: 10,
      business_discovery: 40,
      market_research: 20,
    } as const;

    let currentProgress = 20; // after initial startup weight
    let chain = Promise.resolve();
    const reportProgress = (weight: number, phase: keyof typeof weights) => {
      chain = chain.then(async () => {
        currentProgress += weight;
        await updateSearchProgress(search_id, currentProgress, phase, 'in_progress');
        updateFn('PROGRESS', { phase, progress: currentProgress });
      });
      return chain;

    const taskStatus: Record<string, 'pending' | 'succeeded' | 'failed'> = {
      business_personas: 'pending',
      dm_personas: 'pending',
      business_discovery: 'pending',
      market_research: 'pending'


    };

    const parallelTasks = [
      // Task 1: Business Personas (fast for UI)

      runBusinessPersonas(search).then(async () => {


      runBusinessPersonas(search)
        .then(() => {
          logger.info('Business personas completed', { search_id });
          updateFn('PERSONAS_READY', { type: 'business', search_id });
          return 'business_personas_done';
        })
        .catch(err => {
          logger.warn('Business personas failed', { error: err?.message || err });
          return 'business_personas_failed';
        })
        .finally(() => reportProgress(weights.business_personas, 'business_personas')),

      // Task 2: DM Personas (fast for UI)
      runDMPersonas(search)
        .then(() => {
          logger.info('DM personas completed', { search_id });
          updateFn('PERSONAS_READY', { type: 'dm', search_id });
          return 'dm_personas_done';
        })
        .catch(err => {
          logger.warn('DM personas failed', { error: err?.message || err });
          return 'dm_personas_failed';
        })
        .finally(() => reportProgress(weights.dm_personas, 'dm_personas')),

      // Task 3: Business Discovery (triggers immediate UI updates)
      runBusinessDiscovery(search)
        .then(() => {
          logger.info('Business discovery completed', { search_id });
          updateFn('BUSINESSES_FOUND', { search_id });
          return 'business_discovery_done';
        })
        .catch(err => {
          logger.warn('Business discovery failed', { error: err?.message || err });
          return 'business_discovery_failed';
        })
        .finally(() => reportProgress(weights.business_discovery, 'business_discovery')),

      // Task 4: Market Research (runs independently, provides investor-grade data)
      runMarketResearch(search)
        .then(() => {
          logger.info('Market research completed', { search_id });
          updateFn('MARKET_RESEARCH_READY', { search_id });
          return 'market_research_done';
        })
        .catch(err => {
          logger.warn('Market research failed', { error: err?.message || err });
          return 'market_research_failed';
        })
        .finally(() => reportProgress(weights.market_research, 'market_research')),

      runBusinessPersonas(search).then(() => {

        logger.info('Business personas completed', { search_id });
        taskStatus.business_personas = 'succeeded';
        updateFn('PERSONAS_READY', { type: 'business', search_id });

        await recordStatus('business_personas', 'done');

        updateFn('TASK_STATUS', { task: 'business_personas', status: 'succeeded' });

        return 'business_personas_done';
      }).catch(async err => {
        logger.warn('Business personas failed', { error: err?.message || err });

        await recordStatus('business_personas', 'failed');

        taskStatus.business_personas = 'failed';
        updateFn('TASK_STATUS', { task: 'business_personas', status: 'failed', error: err?.message || err });

        return 'business_personas_failed';
      }),

      // Task 2: DM Personas (fast for UI)
      runDMPersonas(search).then(async () => {
        logger.info('DM personas completed', { search_id });
        taskStatus.dm_personas = 'succeeded';
        updateFn('PERSONAS_READY', { type: 'dm', search_id });

        await recordStatus('dm_personas', 'done');

        updateFn('TASK_STATUS', { task: 'dm_personas', status: 'succeeded' });

        return 'dm_personas_done';
      }).catch(async err => {
        logger.warn('DM personas failed', { error: err?.message || err });

        await recordStatus('dm_personas', 'failed');

        taskStatus.dm_personas = 'failed';
        updateFn('TASK_STATUS', { task: 'dm_personas', status: 'failed', error: err?.message || err });
        return 'dm_personas_failed';
      }),

      // Task 3: Business Discovery (triggers immediate UI updates)
      runBusinessDiscovery(search).then(async () => {
        logger.info('Business discovery completed', { search_id });
        taskStatus.business_discovery = 'succeeded';
        updateFn('BUSINESSES_FOUND', { search_id });
        await recordStatus('business_discovery', 'done');


        updateFn('TASK_STATUS', { task: 'business_discovery', status: 'succeeded' });
        return 'business_discovery_done';
      }).catch(async err => {
        logger.warn('Business discovery failed', { error: err?.message || err });
        await recordStatus('business_discovery', 'failed');
        taskStatus.business_discovery = 'failed';
        updateFn('TASK_STATUS', { task: 'business_discovery', status: 'failed', error: err?.message || err });
        return 'business_discovery_failed';
      }),

      // Task 4: Market Research (runs independently, provides investor-grade data)
      runMarketResearch(search).then(async () => {
        logger.info('Market research completed', { search_id });
        taskStatus.market_research = 'succeeded';
        updateFn('MARKET_RESEARCH_READY', { search_id });
        await recordStatus('market_research', 'done');

        updateFn('TASK_STATUS', { task: 'market_research', status: 'succeeded' });
        return 'market_research_done';
      }).catch(async err => {
        logger.warn('Market research failed', { error: err?.message || err });
        await recordStatus('market_research', 'failed');

        taskStatus.market_research = 'failed';
        updateFn('TASK_STATUS', { task: 'market_research', status: 'failed', error: err?.message || err });
        return 'market_research_failed';
      })
    ];

    // Initialize only; do not force a specific phase to avoid racing agents
    await updateSearchProgress(search_id, 20, 'starting', 'in_progress');
    updateFn('PROGRESS', { phase: 'starting', progress: 20 });

    // Wait for all tasks to complete (or fail)
    logger.debug('Waiting for all parallel tasks to complete', { search_id });
    const results = await Promise.allSettled(parallelTasks);
    
    // Log results
    results.forEach((result, index) => {
      const taskNames = ['Business Personas', 'DM Personas', 'Business Discovery', 'Market Research'];
      if (result.status === 'fulfilled') {
        logger.debug(`${taskNames[index]} finished`, { result: result.value });
      } else {
        logger.warn(`${taskNames[index]} failed`, { error: (result as any).reason });
      }
    });

    // Mark as completed only if at least one task succeeded; otherwise mark failed
    const anySuccess = Object.values(statusMap).some(s => s === 'done');
    const criticalAgents = ['market_research'];
    const criticalFailure = criticalAgents.some(a => statusMap[a] === 'failed');
    if (anySuccess && !criticalFailure) {
      await updateSearchProgress(search_id, 100, 'completed', 'completed', statusMap);
      updateFn('PROGRESS', { phase: 'completed', progress: 100 });
    } else {
      await updateSearchProgress(search_id, 0, 'failed', 'failed', statusMap);
      updateFn('ERROR', { search_id, message: criticalFailure ? 'Critical agent failed' : 'All parallel tasks failed' });

    // Determine overall status based on essential tasks
    const essentialSuccess =
      taskStatus.business_discovery === 'succeeded' &&
      taskStatus.market_research === 'succeeded';

    let overallStatus: 'completed' | 'partial' | 'failed';
    if (essentialSuccess) {
      overallStatus = 'completed';
    } else if (
      taskStatus.business_discovery === 'succeeded' ||
      taskStatus.market_research === 'succeeded'
    ) {
      overallStatus = 'partial';
    } else {
      overallStatus = 'failed';
    }

    const phase = overallStatus === 'failed' ? 'failed' : 'completed';
    await updateSearchProgress(search_id, 100, phase, overallStatus);
    updateFn('PROGRESS', {
      phase,
      progress: 100,
      status: overallStatus,
      tasks: taskStatus
    });

    if (overallStatus === 'failed') {
      updateFn('ERROR', {
        search_id,
        message: 'Essential tasks failed',
        tasks: taskStatus
      });
    }
    
    logger.info('Optimized orchestration finished', { search_id });
    return { success: true, search_id, results: statusMap };
    
  } catch (error: any) {
    logger.error('Orchestration failed', { search_id, error: error?.message || error });
    
    // Update search status to reflect failure
    try {
      await updateSearchProgress(search_id, 0, 'failed', 'failed');
      updateFn('ERROR', { search_id, message: (error?.message || String(error)) });
    } catch (updateError: any) {
      logger.error('Failed to update search progress on error', { error: updateError?.message || updateError });
    }
    
    throw error;
  }
}