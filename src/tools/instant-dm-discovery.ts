import { runDMDiscoveryForBusiness } from '../agents/dm-discovery-individual.agent';

/**
 * Triggers instant DM discovery for businesses as soon as they are found
 * This allows LinkedIn employee searches to start immediately instead of waiting
 * for all businesses to be discovered
 */
export async function triggerInstantDMDiscovery(
  search_id: string, 
  user_id: string, 
  businesses: any[]
) {
  console.log(`🎯 Starting instant DM discovery for ${businesses.length} businesses`);
  
  // Process businesses in small batches to avoid overwhelming the system
  const batchSize = 3;
  for (let i = 0; i < businesses.length; i += batchSize) {
    const batch = businesses.slice(i, i + batchSize);
    
    // Process batch in parallel for speed
    const batchPromises = batch.map(async (business) => {
      try {
        console.log(`🔍 Starting DM discovery for: ${business.name}`);
        
        // Run individual DM discovery for this business
        await runDMDiscoveryForBusiness({
          search_id,
          user_id,
          business_id: business.id,
          business_name: business.name,
          company_country: business.country,
          industry: business.industry
        });
        
        console.log(`✅ DM discovery completed for: ${business.name}`);
      } catch (error) {
        console.error(`❌ DM discovery failed for ${business.name}:`, error);
      }
    });
    
    // Wait for batch to complete before starting next batch
    await Promise.allSettled(batchPromises);
    
    // Small delay between batches to avoid rate limiting
    if (i + batchSize < businesses.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log(`🎉 Instant DM discovery completed for all ${businesses.length} businesses`);
}

/**
 * Process a single business for DM discovery immediately
 * This is called when individual businesses are found
 */
export async function processBusinessForDM(
  search_id: string,
  user_id: string, 
  business: any
) {
  try {
    console.log(`⚡ Processing single business for instant DM discovery: ${business.name}`);
    
    await runDMDiscoveryForBusiness({
      search_id,
      user_id,
      business_id: business.id,
      business_name: business.name,
      company_country: business.country,
      industry: business.industry
    });
    
    console.log(`⚡ Instant DM discovery completed for: ${business.name}`);
  } catch (error) {
    console.error(`⚡ Instant DM discovery failed for ${business.name}:`, error);
  }
}