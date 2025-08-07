import { useState, useEffect, useCallback } from 'react';
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

  // Load all data for a search
  const loadSearchData = useCallback(async (searchId: string) => {
    try {
      setData(prev => ({ ...prev, isLoading: true }));

      // Load all data in parallel using SearchService (with proxy fallback)
      const [
        businesses,
        businessPersonas,
        dmPersonas,
        decisionMakers,
        marketInsights,
        { data: searchProgress }
      ] = await Promise.all([
        SearchService.getBusinesses(searchId),
        SearchService.getBusinessPersonas(searchId),
        SearchService.getDecisionMakerPersonas(searchId),
        SearchService.getDecisionMakers(searchId),
        SearchService.getMarketInsights(searchId),
        supabase.from('user_searches').select('phase, progress_pct').eq('id', searchId).single()
      ]);

      setData({
        businesses: businesses || [],
        businessPersonas: businessPersonas || [],
        dmPersonas: dmPersonas || [],
        decisionMakers: decisionMakers || [],
        marketInsights: marketInsights ? [marketInsights] : [],
        progress: {
          phase: searchProgress?.phase || 'idle',
          progress_pct: searchProgress?.progress_pct || 0,
          businesses_count: (businesses || []).length,
          personas_count: (businessPersonas || []).length + (dmPersonas || []).length,
          decision_makers_count: (decisionMakers || []).length,
          market_insights_ready: !!marketInsights
        },
        isLoading: false
      });

    } catch (error) {
      console.error('Error loading search data:', error);
      setData(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  // Set up real-time subscriptions
  useEffect(() => {
    if (!searchId) return;

    console.log(`🔄 Setting up real-time subscriptions for search: ${searchId}`);

    // Initial load
    loadSearchData(searchId);

    // Real-time subscription for businesses (immediate updates)
    const businessesChannel = supabase
      .channel('businesses-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'businesses',
        filter: `search_id=eq.${searchId}`
      }, (payload) => {
        console.log('📊 Business update received:', payload);
        
        if (payload.eventType === 'INSERT') {
          setData(prev => ({
            ...prev,
            businesses: [...prev.businesses, payload.new],
            progress: {
              ...prev.progress,
              businesses_count: prev.businesses.length + 1
            }
          }));
        } else if (payload.eventType === 'UPDATE') {
          setData(prev => ({
            ...prev,
            businesses: prev.businesses.map(b => 
              b.id === payload.new.id ? { ...b, ...payload.new } : b
            )
          }));
        }
      })
      .subscribe();

    // Real-time subscription for business personas
    const businessPersonasChannel = supabase
      .channel('business-personas-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'business_personas',
        filter: `search_id=eq.${searchId}`
      }, (payload) => {
        console.log('👥 Business persona update received:', payload);
        
        if (payload.eventType === 'INSERT') {
          setData(prev => ({
            ...prev,
            businessPersonas: [...prev.businessPersonas, payload.new].sort((a, b) => a.rank - b.rank),
            progress: {
              ...prev.progress,
              personas_count: prev.progress.personas_count + 1
            }
          }));
        }
      })
      .subscribe();

    // Real-time subscription for DM personas
    const dmPersonasChannel = supabase
      .channel('dm-personas-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'decision_maker_personas',
        filter: `search_id=eq.${searchId}`
      }, (payload) => {
        console.log('🎯 DM persona update received:', payload);
        
        if (payload.eventType === 'INSERT') {
          setData(prev => ({
            ...prev,
            dmPersonas: [...prev.dmPersonas, payload.new].sort((a, b) => a.rank - b.rank),
            progress: {
              ...prev.progress,
              personas_count: prev.progress.personas_count + 1
            }
          }));
        }
      })
      .subscribe();

    // Real-time subscription for decision makers (progressive loading)
    const decisionMakersChannel = supabase
      .channel('decision-makers-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'decision_makers',
        filter: `search_id=eq.${searchId}`
      }, (payload) => {
        console.log('🧑‍💼 Decision maker update received:', payload);
        
        if (payload.eventType === 'INSERT') {
          setData(prev => ({
            ...prev,
            decisionMakers: [...prev.decisionMakers, payload.new],
            progress: {
              ...prev.progress,
              decision_makers_count: prev.decisionMakers.length + 1
            }
          }));
          
        } else if (payload.eventType === 'UPDATE') {
          setData(prev => ({
            ...prev,
            decisionMakers: prev.decisionMakers.map(dm => 
              dm.id === payload.new.id ? { ...dm, ...payload.new } : dm
            )
          }));
        }
      })
      .subscribe();

    // Real-time subscription for market insights
    const marketInsightsChannel = supabase
      .channel('market-insights-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'market_insights',
        filter: `search_id=eq.${searchId}`
      }, (payload) => {
        console.log('📈 Market insights update received:', payload);
        
        if (payload.eventType === 'INSERT') {
          setData(prev => ({
            ...prev,
            marketInsights: [...prev.marketInsights, payload.new],
            progress: {
              ...prev.progress,
              market_insights_ready: true
            }
          }));
        }
      })
      .subscribe();

    // Real-time subscription for search progress
    const searchProgressChannel = supabase
      .channel('search-progress-changes')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'user_searches',
        filter: `id=eq.${searchId}`
      }, (payload) => {
        console.log('⏳ Search progress update received:', payload);
        
        setData(prev => ({
          ...prev,
          progress: {
            ...prev.progress,
            phase: payload.new.phase,
            progress_pct: payload.new.progress_pct
          }
        }));
      })
      .subscribe();

    // Cleanup subscriptions
    return () => {
      console.log(`🧹 Cleaning up real-time subscriptions for search: ${searchId}`);
      
      supabase.removeChannel(businessesChannel);
      supabase.removeChannel(businessPersonasChannel);
      supabase.removeChannel(dmPersonasChannel);
      supabase.removeChannel(decisionMakersChannel);
      supabase.removeChannel(marketInsightsChannel);
      supabase.removeChannel(searchProgressChannel);
    };
  }, [searchId, loadSearchData]);

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