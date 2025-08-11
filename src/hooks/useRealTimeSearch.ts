import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
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
        const { data, error } = await supabase
          .from('user_searches')
          .select('phase, progress_pct')
          .eq('id', searchId)
          .single();
        return error ? { phase: 'business_discovery', progress_pct: 0 } : data as any;
      })();

      const [
        businesses,
        businessPersonas,
        dmPersonas,
        decisionMakers,
        marketInsights,
        searchProgress
      ] = await Promise.all([
        SearchService.getBusinesses(searchId).catch(() => []),
        SearchService.getBusinessPersonas(searchId).catch(() => []),
        SearchService.getDecisionMakerPersonas(searchId).catch(() => []),
        SearchService.getDecisionMakers(searchId).catch(() => []),
        SearchService.getMarketInsights(searchId).catch(() => null),
        progressPromise
      ]);

      setData({
        businesses: businesses || [],
        businessPersonas: businessPersonas || [],
        dmPersonas: dmPersonas || [],
        decisionMakers: decisionMakers || [],
        marketInsights: marketInsights ? [marketInsights] : [],
        progress: {
          phase: searchProgress?.phase || 'business_discovery',
          progress_pct: searchProgress?.progress_pct || 0,
          businesses_count: (businesses || []).length,
          personas_count: (businessPersonas || []).length + (dmPersonas || []).length,
          decision_makers_count: (decisionMakers || []).length,
          market_insights_ready: !!marketInsights
        },
        isLoading: false
      });
      hasLoadedOnceRef.current = true;

    } catch (error) {
      console.error('Error loading search data:', error);
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

    if (process.env.NODE_ENV !== 'production') {
      console.log(`🔄 Setting up real-time subscriptions for search: ${searchId}`);
    }

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
        if (process.env.NODE_ENV !== 'production') console.log('📊 Business update received:', payload);
        
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
        if (status === 'CHANNEL_ERROR') {
          console.warn('Realtime subscription error: businesses');
        }
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
        console.log('👥 Business persona update received:', payload);
        
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
        if (status === 'CHANNEL_ERROR') console.warn('Realtime subscription error: business_personas');
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
        if (process.env.NODE_ENV !== 'production') console.log('🎯 DM persona update received:', payload);
        
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
        if (status === 'CHANNEL_ERROR') console.warn('Realtime subscription error: decision_maker_personas');
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
        if (process.env.NODE_ENV !== 'production') console.log('🧑‍💼 Decision maker update received:', payload);
        
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
        if (status === 'CHANNEL_ERROR') console.warn('Realtime subscription error: decision_makers');
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
        if (process.env.NODE_ENV !== 'production') console.log('📈 Market insights update received:', payload);
        
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
        if (status === 'CHANNEL_ERROR') console.warn('Realtime subscription error: market_insights');
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
        if (process.env.NODE_ENV !== 'production') console.log('⏳ Search progress update received:', payload);
        
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
        if (status === 'CHANNEL_ERROR') console.warn('Realtime subscription error: user_searches');
      });

    // Cleanup subscriptions
    return () => {
      if (process.env.NODE_ENV !== 'production') console.log(`🧹 Cleaning up real-time subscriptions for search: ${searchId}`);
      
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
      if (data.progress.phase !== 'completed') {
        // Silent refresh (no loading spinner on subsequent polls)
        loadSearchData(searchId);
      }
    }, 5000);
    return () => clearInterval(interval);
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