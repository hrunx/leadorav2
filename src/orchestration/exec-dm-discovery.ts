import { run } from '@openai/agents';

import { DMDiscoveryAgent } from '../agents/dm-discovery.agent';
import { loadSearch } from '../tools/db.read';
import { countryToGL } from '../tools/util';

// Call enrichment worker function (non-blocking)
async function enrichDecisionMakersWorker(search_id: string) {
  try {
    console.log(`Starting background enrichment for search ${search_id}`);
    
    const response = await fetch(`/.netlify/functions/enrich-decision-makers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search_id })
    });
    
    if (!response.ok) {
      throw new Error(`Enrichment worker failed: ${response.status}`);
    }
    
    const result = await response.json();
    console.log(`Enrichment completed for search ${search_id}:`, result);
    
  } catch (error) {
    console.error(`Enrichment worker error for search ${search_id}:`, error);
    // Don't throw - enrichment failure shouldn't break the main flow
  }
}

export async function execDMDiscovery(payload: {
  search_id: string;
  user_id: string;
}) {
  const search = await loadSearch(payload.search_id);
  if (!search) throw new Error(`Search ${payload.search_id} not found`);

  const results = [];
  
  // Iterate through all countries and industries for comprehensive coverage
  for (const country of search.countries) {
    for (const industry of search.industries) {
      const gl = countryToGL(country);
      const msg = `search_id=${search.id} user_id=${search.user_id} gl=${gl} industry=${industry} country=${country}
        
Find decision makers for companies in ${industry} industry in ${country} using LinkedIn search. Focus on senior roles like Directors, VPs, Heads, and Managers.

Store basic profiles immediately for fast UI display. Detailed enrichment happens in background.`;

      console.log(`Starting DM discovery for ${industry} in ${country} (gl: ${gl})`);
      
      // Execute fast DM discovery for this country/industry combination
      const result = await run(
        DMDiscoveryAgent,
        [{ role: 'user', content: msg }],
      );

      results.push({
        country,
        industry,
        result: result.text
      });
      
      console.log(`DM Discovery completed for ${industry} in ${country}:`, result.text);
    }
  }
  
  // Start background enrichment (non-blocking) - only once after all discoveries
  enrichDecisionMakersWorker(search.id).catch(error => {
    console.error('Background enrichment failed:', error);
  });
  
  return {
    text: `Completed DM discovery for ${results.length} country/industry combinations`,
    results
  };
}