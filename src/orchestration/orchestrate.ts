import { loadSearch } from '../tools/db.read';
import { updateSearchProgress } from '../tools/db.write';
import { runBusinessPersonas } from '../agents/business-persona.agent';
import { runDMPersonas } from '../agents/dm-persona.agent';
import { runBusinessDiscovery } from '../agents/business-discovery.agent';
import { runMarketResearch } from '../agents/market-research.agent';

export async function orchestrate(search_id: string, _user_id: string, sendUpdate?: (type: string, data: unknown) => void) {
  console.log(`🎬 Starting optimized parallel orchestration for search ${search_id}`);
  
  // Default no-op update function if not provided
  const updateFn = sendUpdate || (() => {});
  
  try {
    const search = await loadSearch(search_id);
    
    // Initialize progress
    await updateSearchProgress(search_id, 5, 'starting', 'in_progress');
    updateFn('PROGRESS', { phase: 'starting', progress: 5 });

    // 🚀 PHASE 1: Launch ALL agents in parallel immediately
    console.log('🚀 Phase 1: Launching all agents in parallel for immediate results');
    
    const parallelTasks = [
      // Task 1: Business Personas (fast for UI)
      runBusinessPersonas(search).then(() => {
        console.log('✅ Business personas completed');
        updateFn('PERSONAS_READY', { type: 'business', search_id });
        return 'business_personas_done';
      }).catch(err => {
        console.error('❌ Business personas failed:', err);
        return 'business_personas_failed';
      }),
      
      // Task 2: DM Personas (fast for UI)
      runDMPersonas(search).then(() => {
        console.log('✅ DM personas completed');
        updateFn('PERSONAS_READY', { type: 'dm', search_id });
        return 'dm_personas_done';
      }).catch(err => {
        console.error('❌ DM personas failed:', err);
        return 'dm_personas_failed';
      }),
      
      // Task 3: Business Discovery (triggers immediate UI updates)
      runBusinessDiscovery(search).then(async () => {
        console.log('✅ Business discovery completed - businesses should appear in UI');
        updateFn('BUSINESSES_FOUND', { search_id });

        return 'business_discovery_done';
      }).catch(err => {
        console.error('❌ Business discovery failed:', err);
        return 'business_discovery_failed';
      }),
      
      // Task 4: Market Research (runs independently, provides investor-grade data)
      runMarketResearch(search).then(() => {
        console.log('✅ Market research completed');
        updateFn('MARKET_RESEARCH_READY', { search_id });
        return 'market_research_done';
      }).catch(err => {
        console.error('❌ Market research failed:', err);
        return 'market_research_failed';
      })
    ];

    // Update progress to show parallel processing has started
    await updateSearchProgress(search_id, 20, 'business_discovery', 'in_progress');
    updateFn('PROGRESS', { phase: 'business_discovery', progress: 20 });

    // Wait for all tasks to complete (or fail)
    console.log('⏳ Waiting for all parallel tasks to complete...');
    const results = await Promise.allSettled(parallelTasks);
    
    // Log results
    results.forEach((result, index) => {
      const taskNames = ['Business Personas', 'DM Personas', 'Business Discovery', 'Market Research'];
      if (result.status === 'fulfilled') {
        console.log(`✅ ${taskNames[index]}: ${result.value}`);
      } else {
        console.error(`❌ ${taskNames[index]} failed:`, result.reason);
      }
    });

    // Mark as completed
    await updateSearchProgress(search_id, 100, 'completed', 'completed');
    updateFn('PROGRESS', { phase: 'completed', progress: 100 });
    
    console.log(`🎉 Optimized orchestration completed successfully for search ${search_id}`);
    return { success: true, search_id, results: results.map(r => r.status) };
    
  } catch (error: any) {
    console.error(`💥 Orchestration failed for search ${search_id}:`, error?.message || error);
    
    // Update search status to reflect failure
    try {
      await updateSearchProgress(search_id, 0, 'failed', 'completed');
      updateFn('ERROR', { search_id, message: (error?.message || String(error)) });
    } catch (updateError) {
      console.error('Failed to update search progress on error:', updateError);
    }
    
    throw error;
  }
}