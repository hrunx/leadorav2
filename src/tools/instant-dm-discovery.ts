import { runDMDiscoveryForBusiness } from '../agents/dm-discovery-individual.agent';
import { updateSearchProgress } from './db.write';

// Track DM discovery progress per search
const dmProgress: Record<string, { total: number; processed: number }> = {};

export function initDMDiscoveryProgress(search_id: string, total: number) {
  dmProgress[search_id] = { total, processed: 0 };
}

async function recordProgress(search_id: string) {
  const progress = dmProgress[search_id];
  if (!progress) return;
  progress.processed += 1;
  const pct = Math.round((progress.processed / progress.total) * 100);
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
  if (!dmProgress[search_id]) {
    initDMDiscoveryProgress(search_id, businesses.length);
  }

  // Process businesses in small batches to avoid overwhelming the system
  const batchSize = 3;
  for (let i = 0; i < businesses.length; i += batchSize) {
    const batch = businesses.slice(i, i + batchSize);

    // Process batch in parallel for speed
    const batchPromises = batch.map(async (business) => {
      await processBusinessForDM(search_id, user_id, business);
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
  business: Business
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
  } catch (error) {
    console.error(`❌ DM discovery failed for ${business.name}:`, error);
  } finally {
    await recordProgress(search_id);
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