import { loadSearch } from '../tools/db.read';
import { loadBusinesses } from '../tools/db.read';
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
    // Normalize shape for agents
    const agentSearch = {
      id: String((search as any)?.id || search_id),
      user_id: String((search as any)?.user_id || ''),
      product_service: String((search as any)?.product_service || ''),
      industries: Array.isArray((search as any)?.industries) ? ((search as any).industries as string[]) : [],
      countries: Array.isArray((search as any)?.countries) ? ((search as any).countries as string[]) : [],
      search_type: ((search as any)?.search_type === 'supplier' ? 'supplier' : 'customer') as 'customer' | 'supplier',
    };
    const useAdvancedResearch = Boolean((search as any)?.use_advanced_research);

    await updateSearchProgress(search_id, 5, 'starting', 'in_progress');
    updateFn('PROGRESS', { phase: 'starting', progress: 5 });

    // Configure market research task once
    const marketResearchTask = useAdvancedResearch ? runAdvancedMarketResearch : runMarketResearch;

    // Weight-based progress reporting
    const weights = { business_personas: 10, dm_personas: 10, business_discovery: 40, market_research: 20 } as const;
    let currentProgress = 20;
    const taskStatus: Record<string, 'done' | 'failed'> = {};
    const recordStatus = async (agent: string, outcome: 'done' | 'failed') => {
      taskStatus[agent] = outcome;
      try {
        await updateSearchProgress(search_id, currentProgress, 'starting', 'in_progress', taskStatus);
      } catch (err: any) {
        logger.warn('Failed to update status_detail', { error: err?.message || err });
      }
    };
    const reportProgress = async (weight: number, phase: keyof typeof weights) => {
      currentProgress += weight;
      await updateSearchProgress(search_id, currentProgress, phase, 'in_progress');
      updateFn('PROGRESS', { phase, progress: currentProgress });
    };

    await updateSearchProgress(search_id, 20, 'starting', 'in_progress');
    updateFn('PROGRESS', { phase: 'starting', progress: 20 });

    // Parallel task executions
    const tasks = [
      {
        key: 'business_personas',
        weight: weights.business_personas,
        phase: 'business_personas' as const,
        run: () => runBusinessPersonas(agentSearch),
        onSuccess: () => updateFn('PERSONAS_READY', { type: 'business', search_id }),
      },
      {
        key: 'dm_personas',
        weight: weights.dm_personas,
        phase: 'dm_personas' as const,
        run: () => runDMPersonas(agentSearch),
        onSuccess: () => updateFn('PERSONAS_READY', { type: 'dm', search_id }),
      },
      {
        key: 'business_discovery',
        weight: weights.business_discovery,
        phase: 'business_discovery' as const,
        run: async () => {
          // Run main discovery flow
          await runBusinessDiscovery(agentSearch);
          // Guard: if still 0 businesses, just log; debug fallback removed for clean prod codebase
          const after = await loadBusinesses(search_id).catch(() => [] as any[]);
          if (!after || after.length === 0) {
            logger.warn('No businesses found after discovery', { search_id });
          }
        },
        onSuccess: async () => {
          updateFn('BUSINESSES_FOUND', { search_id });
          // Defer mapping and DM discovery via jobs dispatcher; enrichment will run after DM insertions
          try {
            const { enqueueJob } = await import('../tools/jobs');
            await enqueueJob('persona_mapping', { search_id });
          } catch (error: any) {
            logger.warn('Failed to enqueue persona mapping', { search_id, error: error?.message });
          }
        },
      },
      {
        key: 'market_research',
        weight: weights.market_research,
        phase: 'market_research' as const,
        run: () => marketResearchTask(agentSearch),
        onSuccess: () => updateFn('MARKET_RESEARCH_READY', { search_id }),
        onError: () => mergeAgentMetadata(search_id, { market_research_warning: true }),
      },
    ];

    const parallelTasks = tasks.map(t =>
      t
        .run()
        .then(async () => { t.onSuccess?.(); await recordStatus(t.key, 'done'); })
        .catch(async (err) => {
          logger.warn(`${t.key} failed`, { error: err?.message || err });
          await t.onError?.();
          await recordStatus(t.key, 'failed');
        })
    );

    const results = await Promise.allSettled(parallelTasks);

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const result = results[i];
      if (result.status === 'fulfilled') {
        logger.debug(`${task.key} finished`, { result: result.value });
      } else {
        logger.warn(`${task.key} failed`, { error: (result as any).reason });
      }
      await reportProgress(task.weight, task.phase);
    }

    const essentialTasks = ['business_personas', 'dm_personas', 'business_discovery'] as const;
    const allEssentialSucceeded = essentialTasks.every(t => taskStatus[t] === 'done');
    
    if (allEssentialSucceeded) {
      // Run persona mapping after essential tasks complete
      try {
        updateFn('PROGRESS', { phase: 'persona_mapping', progress: 95 });
        const { enqueueJob } = await import('../tools/jobs');
        await enqueueJob('persona_mapping', { search_id });
        await enqueueJob('dm_persona_mapping', { search_id });
        updateFn('PROGRESS', { phase: 'completed', progress: 100 });
      } catch (mappingError: any) {
        logger.warn('Persona mapping failed but search still completed', { 
          search_id, 
          error: mappingError?.message || mappingError 
        });
      }
      
      await updateSearchProgress(search_id, 100, 'completed', 'completed', taskStatus);
    } else {
      await updateSearchProgress(search_id, 0, 'failed', 'failed', taskStatus);
      updateFn('ERROR', { search_id, message: 'One or more essential tasks failed' });
    }

    logger.info('Optimized orchestration finished', { search_id });
    return { success: allEssentialSucceeded, search_id, results: taskStatus };
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
