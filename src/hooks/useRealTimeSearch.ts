import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import logger from '../lib/logger';
import { SearchService } from '../services/searchService';
import type { Business, DecisionMakerPersona, DecisionMaker, MarketInsight } from '../lib/supabase';

interface SearchProgress {
  phase: string;
  progress_pct: number;
  businesses_count: number;
  personas_count: number;
  decision_makers_count: number;
  market_insights_ready: boolean;
}

interface RealTimeSearchData {
  businesses: Business[];
  businessPersonas: DecisionMakerPersona[];
  dmPersonas: DecisionMakerPersona[];
  decisionMakers: DecisionMaker[];
  marketInsights: MarketInsight[];
  progress: SearchProgress;
  isLoading: boolean;
}

export function useRealTimeSearch(searchId: string | null) {
  const [data, setData] = useState<RealTimeSearchData>({
    businesses: [],
    businessPersonas: [],
    dmPersonas: [],
    decisionMakers: [],
    marketInsights: [],
    progress: {
      phase: 'idle',
      progress_pct: 0,
      businesses_count: 0,
      personas_count: 0,
      decision_makers_count: 0,
      market_insights_ready: false
    },
    isLoading: false
  });
  const hasLoadedOnceRef = useRef(false);

  // Load all data for a search
  const loadSearchData = useCallback(async (searchId: string) => {
    try {
      // Only show loading on the very first load to avoid UI flicker on polling
      setData(prev => (hasLoadedOnceRef.current ? prev : { ...prev, isLoading: true }));

      // Load all data in parallel using SearchService (with proxy fallback)
      const progressPromise = (async () => {
        try {
          const r = await fetch(`/.netlify/functions/user-data-proxy?table=user_searches&search_id=${searchId}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          });
          if (r.ok) {
            const arr = await r.json();
            const row = Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
            if (row) return { phase: row.phase, progress_pct: row.progress_pct } as any;
          }
        } catch {}
        return null as any;
      })();

      const [
        fetchedBusinesses,
        fetchedBusinessPersonas,
        fetchedDmPersonas,
        fetchedDecisionMakers,
        fetchedMarketInsights,
        searchProgress
      ] = await Promise.all([
        SearchService.getBusinesses(searchId).catch(() => []),
        SearchService.getBusinessPersonas(searchId).catch(() => []),
        SearchService.getDecisionMakerPersonas(searchId).catch(() => []),
        SearchService.getDecisionMakers(searchId).catch(() => []),
        SearchService.getMarketInsights(searchId).catch(() => null),
        progressPromise
      ]);

      const mergeById = (prev: any[], next: any[]) => {
        const map = new Map<string, any>();
        for (const item of prev || []) {
          const id = String((item as any)?.id || '');
          if (id) map.set(id, item);
        }
        for (const item of next || []) {
          const id = String((item as any)?.id || '');
          if (!id) continue;
          map.set(id, { ...(map.get(id) || {}), ...item });
        }
        return Array.from(map.values());
      };

      setData(prev => {
        const nextBusinesses = mergeById(prev.businesses, fetchedBusinesses || []);
        const nextBusinessPersonas = mergeById(prev.businessPersonas, fetchedBusinessPersonas || []);
        const nextDmPersonas = mergeById(prev.dmPersonas, fetchedDmPersonas || []);
        const nextDecisionMakers = mergeById(prev.decisionMakers, fetchedDecisionMakers || []);
        const nextInsights = fetchedMarketInsights ? [fetchedMarketInsights] : prev.marketInsights;

        return {
          businesses: nextBusinesses,
          businessPersonas: nextBusinessPersonas,
          dmPersonas: nextDmPersonas,
          decisionMakers: nextDecisionMakers,
          marketInsights: nextInsights,
          progress: {
            phase: searchProgress?.phase || prev.progress.phase || 'idle',
            progress_pct: typeof searchProgress?.progress_pct === 'number' ? searchProgress.progress_pct : (prev.progress.progress_pct || 0),
            businesses_count: nextBusinesses.length,
            personas_count: nextBusinessPersonas.length + nextDmPersonas.length,
            decision_makers_count: nextDecisionMakers.length,
            market_insights_ready: (nextInsights && nextInsights.length > 0) || false
          },
          isLoading: false
        };
      });
      hasLoadedOnceRef.current = true;

    } catch (error: any) {
      logger.warn('Error loading search data', { error: error?.message || String(error) });
      setData(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  // Set up real-time subscriptions
  useEffect(() => {
    if (!searchId) return;
    // Reset state when searchId changes to avoid stale content
    hasLoadedOnceRef.current = false;
    setData({
      businesses: [],
      businessPersonas: [],
      dmPersonas: [],
      decisionMakers: [],
      marketInsights: [],
      progress: {
        phase: 'idle',
        progress_pct: 0,
        businesses_count: 0,
        personas_count: 0,
        decision_makers_count: 0,
        market_insights_ready: false
      },
      isLoading: true
    });

    logger.debug(`🔄 Setting up real-time subscriptions for search: ${searchId}`);

    // Initial load
    loadSearchData(searchId);

    // Real-time subscription for businesses (immediate updates)
    const businessesChannel = supabase
      .channel(`businesses-changes-${searchId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'businesses',
        filter: `search_id=eq.${searchId}`
      }, (payload) => {
        logger.debug('📊 Business update received:', payload);
        
        if (payload.eventType === 'INSERT') {
          setData(prev => {
            const newBiz = payload.new as Business;
            const next = {
              ...prev,
              businesses: ([...prev.businesses, newBiz] as Business[]),
              progress: {
                ...prev.progress,
                businesses_count: prev.businesses.length + 1
              }
            };
            return next;
          });
        } else if (payload.eventType === 'UPDATE') {
          setData(prev => {
            const updated = prev.businesses.map(b => 
              b.id === (payload.new as Business).id ? ({ ...b, ...(payload.new as Business) } as Business) : b
            ) as Business[];
            return { ...prev, businesses: updated };
          });
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') return;
        if (status === 'CHANNEL_ERROR') { logger.warn('Realtime subscription error: businesses'); }
      });

    // Real-time subscription for business personas
    const businessPersonasChannel = supabase
      .channel(`business-personas-changes-${searchId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'business_personas',
        filter: `search_id=eq.${searchId}`
      }, (payload) => {
        logger.debug('👥 Business persona update received:', payload);
        
        if (payload.eventType === 'INSERT') {
          setData(prev => {
            const newPersona = payload.new as DecisionMakerPersona;
            const sorted = ([...prev.businessPersonas, newPersona] as DecisionMakerPersona[]).sort((a, b) => (a.rank as any) - (b.rank as any));
            return {
              ...prev,
              businessPersonas: sorted,
              progress: { ...prev.progress, personas_count: prev.progress.personas_count + 1 }
            };
          });
        }
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') logger.warn('Realtime subscription error: business_personas');
      });

    // Real-time subscription for DM personas
    const dmPersonasChannel = supabase
      .channel(`dm-personas-changes-${searchId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'decision_maker_personas',
        filter: `search_id=eq.${searchId}`
      }, (payload) => {
        logger.debug('🎯 DM persona update received:', payload);
        
        if (payload.eventType === 'INSERT') {
          setData(prev => {
            const newPersona = payload.new as DecisionMakerPersona;
            const sorted = ([...prev.dmPersonas, newPersona] as DecisionMakerPersona[]).sort((a, b) => (a.rank as any) - (b.rank as any));
            return {
              ...prev,
              dmPersonas: sorted,
              progress: { ...prev.progress, personas_count: prev.progress.personas_count + 1 }
            };
          });
        }
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') logger.warn('Realtime subscription error: decision_maker_personas');
      });

    // Real-time subscription for decision makers (progressive loading)
    const decisionMakersChannel = supabase
      .channel(`decision-makers-changes-${searchId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'decision_makers',
        filter: `search_id=eq.${searchId}`
      }, (payload) => {
        logger.debug('🧑‍💼 Decision maker update received:', payload);
        
        if (payload.eventType === 'INSERT') {
          setData(prev => {
            const newDM = payload.new as DecisionMaker;
            const nextDMs = ([...prev.decisionMakers, newDM] as DecisionMaker[]);
            return {
              ...prev,
              decisionMakers: nextDMs,
              progress: { ...prev.progress, decision_makers_count: prev.decisionMakers.length + 1 }
            };
          });
        } else if (payload.eventType === 'UPDATE') {
          setData(prev => {
            const updated = prev.decisionMakers.map(dm => 
              dm.id === (payload.new as DecisionMaker).id ? ({ ...dm, ...(payload.new as DecisionMaker) } as DecisionMaker) : dm
            ) as DecisionMaker[];
            return { ...prev, decisionMakers: updated };
          });
        }
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') logger.warn('Realtime subscription error: decision_makers');
      });

    // Real-time subscription for market insights
    const marketInsightsChannel = supabase
      .channel(`market-insights-changes-${searchId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'market_insights',
        filter: `search_id=eq.${searchId}`
      }, (payload) => {
        logger.debug('📈 Market insights update received:', payload);
        
        if (payload.eventType === 'INSERT') {
          setData(prev => {
            const newInsight = payload.new as MarketInsight;
            const nextInsights = ([...prev.marketInsights, newInsight] as MarketInsight[]);
            return {
              ...prev,
              marketInsights: nextInsights,
              progress: { ...prev.progress, market_insights_ready: true }
            };
          });
        }
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') logger.warn('Realtime subscription error: market_insights');
      });

    // Real-time subscription for search progress
    const searchProgressChannel = supabase
      .channel(`search-progress-changes-${searchId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'user_searches',
        filter: `id=eq.${searchId}`
      }, (payload) => {
        logger.debug('⏳ Search progress update received:', payload);
        
        setData(prev => ({
          ...prev,
          progress: {
            ...prev.progress,
            phase: payload.new.phase,
            progress_pct: payload.new.progress_pct
          }
        }));
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') logger.warn('Realtime subscription error: user_searches');
      });

    // Cleanup subscriptions
    return () => {
      logger.debug(`🧹 Cleaning up real-time subscriptions for search: ${searchId}`);
      
      supabase.removeChannel(businessesChannel);
      supabase.removeChannel(businessPersonasChannel);
      supabase.removeChannel(dmPersonasChannel);
      supabase.removeChannel(decisionMakersChannel);
      supabase.removeChannel(marketInsightsChannel);
      supabase.removeChannel(searchProgressChannel);
    };
  }, [searchId, loadSearchData]);

  // Polling fallback: refresh data periodically while not completed (handles network drop/CORS issues)
  useEffect(() => {
    if (!searchId) return;
    const interval = setInterval(() => {
      if (data.progress.phase !== 'completed' && data.progress.phase !== 'cancelled') {
        // Silent refresh (no loading spinner on subsequent polls)
        loadSearchData(searchId);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [searchId, data.progress.phase, loadSearchData]);

  // Force one final refresh when backend marks the run completed to capture any late inserts
  useEffect(() => {
    if (!searchId) return;
    if (data.progress.phase === 'completed') {
      void loadSearchData(searchId);
    }
  }, [searchId, data.progress.phase, loadSearchData]);

  // Helper function to get decision makers for a specific persona
  const getDecisionMakersForPersona = (personaId: string) => {
    return data.decisionMakers.filter(dm => dm.persona_id === personaId);
  };

  // Helper function to get all decision makers grouped by persona
  const getDecisionMakersByPersona = () => {
    const grouped: Record<string, any[]> = {};
    
    data.dmPersonas.forEach(persona => {
      grouped[persona.id] = data.decisionMakers.filter(dm => dm.persona_id === persona.id);
    });
    
    return grouped;
  };

  return {
    ...data,
    refresh: () => searchId ? loadSearchData(searchId) : null,
    getDecisionMakersForPersona,
    getDecisionMakersByPersona
  };
}