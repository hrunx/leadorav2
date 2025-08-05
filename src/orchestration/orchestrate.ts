import { loadSearch } from '../tools/db.read';
import { updateSearchProgress } from '../tools/db.write';
import { runBusinessPersonas } from '../agents/business-persona.agent';
import { runDMPersonas } from '../agents/dm-persona.agent';
import { runBusinessDiscovery } from '../agents/business-discovery.agent';
import { runDMDiscovery } from '../agents/dm-discovery.agent';
import { runMarketResearch } from '../agents/market-research.agent';

export async function orchestrate(search_id: string, user_id: string) {
  console.log(`Starting orchestration for search ${search_id}`);
  
  try {
    const search = await loadSearch(search_id);
    
    // Initialize progress
    await updateSearchProgress(search_id, 0, 'starting', 'in_progress');

    // Phase A (parallel): personas - both run simultaneously
    console.log('Phase A: Generating personas in parallel');
    const personaResults = await Promise.allSettled([
      runBusinessPersonas(search),
      runDMPersonas(search)
    ]);
    
    // Check if persona generation had any failures
    const personaFailures = personaResults.filter(r => r.status === 'rejected');
    if (personaFailures.length > 0) {
      console.warn(`${personaFailures.length} persona generation(s) failed, continuing with available data`);
    }

    // Phase B: businesses (needs business personas)
    console.log('Phase B: Business discovery');
    await runBusinessDiscovery(search);

    // Phase C: decision makers (needs businesses + DM personas)
    console.log('Phase C: Decision maker discovery');
    await runDMDiscovery(search);

    // Phase D: market insights (reads everything)
    console.log('Phase D: Market research');
    await runMarketResearch(search);

    console.log(`Orchestration completed successfully for search ${search_id}`);
    return { success: true, search_id };
    
  } catch (error) {
    console.error(`Orchestration failed for search ${search_id}:`, error);
    
    // Update search status to reflect failure
    try {
      await updateSearchProgress(search_id, 0, 'failed', 'completed');
    } catch (updateError) {
      console.error('Failed to update search progress on error:', updateError);
    }
    
    throw error;
  }
}