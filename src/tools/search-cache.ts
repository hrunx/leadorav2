import { supabase } from '../lib/supabase';
import logger from '../lib/logger';
// import { buildProxyUrl } from '../utils/baseUrl';
import type { Business, DecisionMakerPersona, DecisionMaker, MarketInsight } from '../lib/supabase';

export interface CachedSearchData {
  searchId: string;
  businesses: Business[];
  businessPersonas: DecisionMakerPersona[];
  dmPersonas: DecisionMakerPersona[];
  decisionMakers: DecisionMaker[];
  marketInsights: MarketInsight[];
  progress: {
    phase: string;
    progress_pct: number;
    businesses_count: number;
    personas_count: number;
    decision_makers_count: number;
    market_insights_ready: boolean;
  };
  lastUpdated: string;
  isComplete: boolean;
}

export interface SearchCacheOptions {
  ttlHours?: number;
  forceRefresh?: boolean;
  includeIncomplete?: boolean;
}

class SearchCacheManager {
  private memoryCache = new Map<string, CachedSearchData>();
  private defaultTtlHours = 24; // Cache for 24 hours by default
  private maxMemoryCacheSize = 100; // Limit memory cache size

  async getCachedSearch(
    searchId: string, 
    options: SearchCacheOptions = {}
  ): Promise<CachedSearchData | null> {
    const { 
      ttlHours = this.defaultTtlHours, 
      forceRefresh = false,
      includeIncomplete = false 
    } = options;

    // Check memory cache first (if not force refreshing)
    if (!forceRefresh) {
      const memoryCached = this.memoryCache.get(searchId);
      if (memoryCached && this.isCacheValid(memoryCached, ttlHours)) {
        if (memoryCached.isComplete || includeIncomplete) {
          logger.debug('Serving search from memory cache', { searchId });
          return memoryCached;
        }
      }
    }

    try {
      // Direct Supabase only; skip proxy to avoid 406 noise in dev
      const { data: cacheEntry, error } = await supabase
        .from('search_cache')
        .select('*')
        .eq('search_id', searchId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.warn('Error fetching search cache', { searchId, error: error.message });
        return null;
      }

      if (cacheEntry) {
        const cachedData = this.parseCacheEntry(cacheEntry);
        if (!forceRefresh && this.isCacheValid(cachedData, ttlHours)) {
          if (cachedData.isComplete || includeIncomplete) {
            this.updateMemoryCache(searchId, cachedData);
            logger.debug('Serving search from database cache', { searchId });
            return cachedData;
          }
        }
      }

      return null;

    } catch (error: any) {
      logger.error('Failed to get cached search', { searchId, error: error.message });
      return null;
    }
  }

  async cacheSearchData(searchData: CachedSearchData): Promise<void> {
    try {
      // Update memory cache
      this.updateMemoryCache(searchData.searchId, searchData);

      // Update database cache
      const cacheEntry = {
        search_id: searchData.searchId,
        businesses: JSON.stringify(searchData.businesses),
        business_personas: JSON.stringify(searchData.businessPersonas),
        dm_personas: JSON.stringify(searchData.dmPersonas),
        decision_makers: JSON.stringify(searchData.decisionMakers),
        market_insights: JSON.stringify(searchData.marketInsights),
        progress: JSON.stringify(searchData.progress),
        is_complete: searchData.isComplete,
        last_updated: searchData.lastUpdated,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('search_cache')
        .upsert(cacheEntry, {
          onConflict: 'search_id'
        });

      if (error) {
        throw error;
      }

      logger.debug('Successfully cached search data', { 
        searchId: searchData.searchId,
        isComplete: searchData.isComplete,
        businessCount: searchData.businesses.length,
        dmCount: searchData.decisionMakers.length
      });

    } catch (error: any) {
      logger.error('Failed to cache search data', { 
        searchId: searchData.searchId, 
        error: error.message 
      });
    }
  }

  async invalidateCache(searchId: string): Promise<void> {
    try {
      // Remove from memory cache
      this.memoryCache.delete(searchId);

      // Remove from database cache
      const { error } = await supabase
        .from('search_cache')
        .delete()
        .eq('search_id', searchId);

      if (error) {
        throw error;
      }

      logger.debug('Cache invalidated', { searchId });

    } catch (error: any) {
      logger.error('Failed to invalidate cache', { searchId, error: error.message });
    }
  }

  async refreshSearchCache(searchId: string): Promise<CachedSearchData | null> {
    try {
      // First, invalidate existing cache
      await this.invalidateCache(searchId);

      // Fetch fresh data from all sources
      const freshData = await this.fetchFreshSearchData(searchId);
      
      if (freshData) {
        // Cache the fresh data
        await this.cacheSearchData(freshData);
        return freshData;
      }

      return null;

    } catch (error: any) {
      logger.error('Failed to refresh search cache', { searchId, error: error.message });
      return null;
    }
  }

  private async fetchFreshSearchData(searchId: string): Promise<CachedSearchData | null> {
    try {
      // Fetch data from all tables in parallel
      const [
        businessesResponse,
        businessPersonasResponse,
        dmPersonasResponse,
        decisionMakersResponse,
        marketInsightsResponse,
        searchProgressResponse
      ] = await Promise.allSettled([
        supabase.from('businesses').select('*').eq('search_id', searchId),
        supabase.from('business_personas').select('*').eq('search_id', searchId),
        supabase.from('decision_maker_personas').select('*').eq('search_id', searchId),
        supabase.from('decision_makers').select('*').eq('search_id', searchId),
        supabase.from('market_insights').select('*').eq('search_id', searchId),
        supabase.from('user_searches').select('*').eq('id', searchId).single()
      ]);

      // Extract successful results
      const businesses = businessesResponse.status === 'fulfilled' && businessesResponse.value.data ? 
        businessesResponse.value.data : [];
      const businessPersonas = businessPersonasResponse.status === 'fulfilled' && businessPersonasResponse.value.data ? 
        businessPersonasResponse.value.data : [];
      const dmPersonas = dmPersonasResponse.status === 'fulfilled' && dmPersonasResponse.value.data ? 
        dmPersonasResponse.value.data : [];
      const decisionMakers = decisionMakersResponse.status === 'fulfilled' && decisionMakersResponse.value.data ? 
        decisionMakersResponse.value.data : [];
      const marketInsights = marketInsightsResponse.status === 'fulfilled' && marketInsightsResponse.value.data ? 
        marketInsightsResponse.value.data : [];
      const searchProgress = searchProgressResponse.status === 'fulfilled' && searchProgressResponse.value.data ? 
        searchProgressResponse.value.data : null;

      const isComplete = searchProgress?.phase === 'completed' || searchProgress?.status === 'completed';

      const cachedData: CachedSearchData = {
        searchId,
        businesses: businesses as Business[],
        businessPersonas: businessPersonas as DecisionMakerPersona[],
        dmPersonas: dmPersonas as DecisionMakerPersona[],
        decisionMakers: decisionMakers as DecisionMaker[],
        marketInsights: marketInsights as MarketInsight[],
        progress: {
          phase: searchProgress?.phase || 'idle',
          progress_pct: searchProgress?.progress_pct || 0,
          businesses_count: businesses.length,
          personas_count: businessPersonas.length + dmPersonas.length,
          decision_makers_count: decisionMakers.length,
          market_insights_ready: marketInsights.length > 0
        },
        lastUpdated: new Date().toISOString(),
        isComplete
      };

      return cachedData;

    } catch (error: any) {
      logger.error('Failed to fetch fresh search data', { searchId, error: error.message });
      return null;
    }
  }

  private parseCacheEntry(cacheEntry: any): CachedSearchData {
    return {
      searchId: cacheEntry.search_id,
      businesses: this.safeParse(cacheEntry.businesses, []),
      businessPersonas: this.safeParse(cacheEntry.business_personas, []),
      dmPersonas: this.safeParse(cacheEntry.dm_personas, []),
      decisionMakers: this.safeParse(cacheEntry.decision_makers, []),
      marketInsights: this.safeParse(cacheEntry.market_insights, []),
      progress: this.safeParse(cacheEntry.progress, {
        phase: 'idle',
        progress_pct: 0,
        businesses_count: 0,
        personas_count: 0,
        decision_makers_count: 0,
        market_insights_ready: false
      }),
      lastUpdated: cacheEntry.last_updated || cacheEntry.updated_at,
      isComplete: cacheEntry.is_complete || false
    };
  }

  private safeParse(jsonString: string, fallback: any): any {
    try {
      return JSON.parse(jsonString);
    } catch {
      return fallback;
    }
  }

  private isCacheValid(cachedData: CachedSearchData, ttlHours: number): boolean {
    const lastUpdated = new Date(cachedData.lastUpdated);
    const now = new Date();
    const hoursSinceUpdate = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);
    
    return hoursSinceUpdate < ttlHours;
  }

  private updateMemoryCache(searchId: string, data: CachedSearchData): void {
    // Implement LRU-like behavior by removing oldest entries if cache is full
    if (this.memoryCache.size >= this.maxMemoryCacheSize) {
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey) {
        this.memoryCache.delete(firstKey);
      }
    }

    this.memoryCache.set(searchId, data);
  }

  async cleanExpiredCache(ttlHours: number = 48): Promise<void> {
    try {
      const expiredBefore = new Date();
      expiredBefore.setHours(expiredBefore.getHours() - ttlHours);

      const { error } = await supabase
        .from('search_cache')
        .delete()
        .lt('updated_at', expiredBefore.toISOString());

      if (error) {
        throw error;
      }

      logger.info('Cleaned expired cache entries', { ttlHours });

    } catch (error: any) {
      logger.error('Failed to clean expired cache', { error: error.message });
    }
  }

  getCacheStats(): { memoryEntries: number; lastCleanup?: string } {
    return {
      memoryEntries: this.memoryCache.size
    };
  }
}

// Export singleton instance
export const searchCache = new SearchCacheManager();

// Convenience functions
export async function getCachedSearchData(
  searchId: string, 
  options?: SearchCacheOptions
): Promise<CachedSearchData | null> {
  return searchCache.getCachedSearch(searchId, options);
}

export async function cacheSearchData(data: CachedSearchData): Promise<void> {
  return searchCache.cacheSearchData(data);
}

export async function invalidateSearchCache(searchId: string): Promise<void> {
  return searchCache.invalidateCache(searchId);
}

export async function refreshSearchData(searchId: string): Promise<CachedSearchData | null> {
  return searchCache.refreshSearchCache(searchId);
}
