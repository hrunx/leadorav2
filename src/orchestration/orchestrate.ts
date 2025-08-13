import { loadSearch } from '../tools/db.read';
import { updateSearchProgress, mergeAgentMetadata } from '../tools/db.write';
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

    const taskStatus: Record<string, 'pending' | 'success' | 'failed'> = {
      business_personas: 'pending',
      dm_personas: 'pending',
      business_discovery: 'pending',
      market_research: 'pending'
    };

    const parallelTasks = [
      // Task 1: Business Personas (fast for UI)
      runBusinessPersonas(search).then(() => {
        logger.info('Business personas completed', { search_id });
        updateFn('PERSONAS_READY', { type: 'business', search_id });
        taskStatus.business_personas = 'success';
        return 'business_personas_done';
      }).catch(err => {
        logger.warn('Business personas failed', { error: err?.message || err });
        taskStatus.business_personas = 'failed';
        return 'business_personas_failed';
      }),
      
      // Task 2: DM Personas (fast for UI)
      runDMPersonas(search).then(() => {
        logger.info('DM personas completed', { search_id });
        updateFn('PERSONAS_READY', { type: 'dm', search_id });
        taskStatus.dm_personas = 'success';
        return 'dm_personas_done';
      }).catch(err => {
        logger.warn('DM personas failed', { error: err?.message || err });
        taskStatus.dm_personas = 'failed';
        return 'dm_personas_failed';
      }),
      
      // Task 3: Business Discovery (triggers immediate UI updates)
      runBusinessDiscovery(search).then(async () => {
        logger.info('Business discovery completed', { search_id });
        updateFn('BUSINESSES_FOUND', { search_id });
        taskStatus.business_discovery = 'success';
        return 'business_discovery_done';
      }).catch(err => {
        logger.warn('Business discovery failed', { error: err?.message || err });
        taskStatus.business_discovery = 'failed';
        return 'business_discovery_failed';
      }),
      
      // Task 4: Market Research (runs independently, provides investor-grade data)
      runMarketResearch(search).then(() => {
        logger.info('Market research completed', { search_id });
        updateFn('MARKET_RESEARCH_READY', { search_id });
        taskStatus.market_research = 'success';
        return 'market_research_done';
      }).catch(async err => {
        logger.warn('Market research failed', { error: err?.message || err });
        taskStatus.market_research = 'failed';
        try { await mergeAgentMetadata(search_id, { market_research_warning: true }); } catch (e: any) { logger.warn('Failed to set market research warning', { error: e?.message || e }); }
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
    const anySuccess = Object.values(taskStatus).some(s => s === 'success');
    if (anySuccess) {
      await updateSearchProgress(search_id, 100, 'completed', 'completed');
      updateFn('PROGRESS', { phase: 'completed', progress: 100 });
    } else {
      await updateSearchProgress(search_id, 0, 'failed', 'failed');
      updateFn('ERROR', { search_id, message: 'All parallel tasks failed' });
    }
    
    logger.info('Optimized orchestration finished', { search_id });
    return { success: true, search_id, task_status: taskStatus };
    
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