import { runDMDiscoveryForBusiness } from '../agents/dm-discovery-individual.agent';
import { updateSearchProgress } from './db.write';
import { loadSearch } from './db.read';

// Track DM discovery progress per search
const dmProgress: Record<string, { total: number; processed: number }> = {};

export function initDMDiscoveryProgress(search_id: string, total: number) {
  const progress = dmProgress[search_id];
  if (progress) {
    progress.total += total;
  } else {
    dmProgress[search_id] = { total, processed: 0 };
  }
}

async function recordProgress(search_id: string) {
  const progress = dmProgress[search_id];
  if (!progress) return;
  progress.processed += 1;
  const denominator = progress.total || 1; // guard against zero to avoid NaN/Infinity
  const pct = Math.round((progress.processed / denominator) * 100);
  await updateSearchProgress(search_id, pct, 'decision_makers');
  if (progress.processed >= progress.total) {
    delete dmProgress[search_id];
  }
}

/**
 * Triggers instant DM discovery for businesses as soon as they are found
 * This allows LinkedIn employee searches to start immediately instead of waiting
 * for all businesses to be discovered
 */
export async function triggerInstantDMDiscovery(
  search_id: string,
  user_id: string,
  businesses: Business[]
) {
  console.log(`🎯 Starting instant DM discovery for ${businesses.length} businesses`);
  initDMDiscoveryProgress(search_id, businesses.length);

  // Load search data once for all businesses to get product/service context
  const searchData = await loadSearch(search_id);

  // Process businesses in small batches to avoid overwhelming the system
  const batchSize = 2;
  for (let i = 0; i < businesses.length; i += batchSize) {
    const batch = businesses.slice(i, i + batchSize);

    // Process batch in parallel for speed
    const batchPromises = batch.map(async (business) => {
      await processBusinessForDM(search_id, user_id, business, searchData?.product_service);
    });

    // Wait for batch to complete before starting next batch
    await Promise.allSettled(batchPromises);

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < businesses.length) {
      await new Promise(resolve => setTimeout(resolve, 2500));
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
  business: Business,
  product_service?: string
): Promise<boolean> {
  try {
    console.log(`⚡ Processing single business for instant DM discovery: ${business.name}`);
    
    // Avoid redundant DB lookups by accepting product_service from caller when available
    const productService = product_service ?? (await loadSearch(search_id))?.product_service;
    
    await runDMDiscoveryForBusiness({
      search_id,
      user_id,
      business_id: business.id,
      business_name: business.name,
      company_country: business.country,
      industry: business.industry,
      product_service: productService
    });
    await recordProgress(search_id);
    return true;
  } catch (error) {
    console.error(`❌ DM discovery failed for ${business.name}:`, error);
    await recordProgress(search_id);
    return false;
  }
}

// Define the Business interface
export interface Business {
  id: string;
  search_id: string;
  user_id: string;
  persona_id: string | null;
  name: string;
  industry: string;
  country: string;
  city?: string;
  size?: string;
  revenue?: string;
  description?: string;
  match_score: number;
  relevant_departments?: string[];
  key_products?: string[];
  recent_activity?: string[];
  persona_type: string;
  created_at?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  rating?: number;
}
