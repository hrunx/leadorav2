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

  const country = search.countries[0]; 
  const gl = countryToGL(country);
  const msg = `search_id=${search.id} user_id=${search.user_id} gl=${gl} industry=${search.industries[0]} country=${country}
    
Find decision makers for each company using LinkedIn search. Focus on senior roles like Directors, VPs, Heads, and Managers.

Store basic profiles immediately for fast UI display. Detailed enrichment happens in background.`;

  // Execute fast DM discovery
  const result = await run(
    DMDiscoveryAgent,
    [{ role: 'user', content: msg }],
  );

  // Start background enrichment (non-blocking)
  enrichDecisionMakersWorker(search.id).catch(error => {
    console.error('Background enrichment failed:', error);
  });

  return result;
}