import { createContext, useContext, useReducer, ReactNode, useEffect, useCallback } from 'react';
import logger from '../lib/logger';
import { useAuth } from './AuthContext';
import { isDemoUser } from '../constants/demo';
import { SearchService } from '../services/searchService';
import { CampaignService } from '../services/campaignService';
import type { UserSearch, EmailCampaign } from '../lib/supabase';

interface UserDataState {
  searchHistory: UserSearch[];
  activeCampaigns: EmailCampaign[];
  totalLeadsGenerated: number;
  totalCampaignsSent: number;
  isLoading: boolean;
  currentSearchId: string | null;
}

interface UserDataContextType {
  state: UserDataState;
  createSearch: (searchData: any) => Promise<string>;
  loadUserData: () => Promise<void>;
  setCurrentSearch: (searchId: string) => void;
  getCurrentSearch: () => UserSearch | null;
  getSearch: (searchId: string) => UserSearch | null;
}

const initialState: UserDataState = {
  searchHistory: [],
  activeCampaigns: [],
  totalLeadsGenerated: 0,
  totalCampaignsSent: 0,
  isLoading: false,
  currentSearchId: null
};

const UserDataContext = createContext<UserDataContextType | undefined>(undefined);

function userDataReducer(state: UserDataState, action: any): UserDataState {
  switch (action.type) {
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload
      };
    case 'LOAD_USER_DATA':
      return {
        ...state,
        searchHistory: action.payload.searches || [],
        activeCampaigns: action.payload.campaigns || [],
        totalLeadsGenerated: action.payload.totalLeads || 0,
        totalCampaignsSent: action.payload.totalCampaigns || 0,
        isLoading: false
      };
    case 'SET_CURRENT_SEARCH':
      return {
        ...state,
        currentSearchId: action.payload
      };
    case 'ADD_SEARCH':
      return {
        ...state,
        searchHistory: [action.payload, ...state.searchHistory],
        currentSearchId: action.payload.id
      };
    default:
      return state;
  }
}

export function UserDataProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(userDataReducer, initialState);
  const { state: authState } = useAuth();
  
  // Restore current search from localStorage to survive reloads
  useEffect(() => {
    try {
      const stored = (typeof window !== 'undefined') ? window.localStorage.getItem('currentSearchId') : null;
      if (stored) {
        dispatch({ type: 'SET_CURRENT_SEARCH', payload: stored });
      }
    } catch {}
  }, []);

  const loadUserDataFromDB = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    
    try {
      if (!authState.user) return;

      const [searches, campaigns] = await Promise.all([
        SearchService.getUserSearches(authState.user.id),
        CampaignService.getUserCampaigns(authState.user.id)
      ]);

      // Calculate total leads from search totals (much faster)
      const totalLeads = searches.reduce((sum, search) => {
        const totals = search.totals || {};
        return sum + (totals.businesses || 0) + (totals.decision_makers || 0);
      }, 0);

      dispatch({ 
        type: 'LOAD_USER_DATA', 
        payload: {
          searches,
          campaigns,
          totalLeads,
          totalCampaigns: campaigns.length
        }
      });
    } catch (error) {
      import('../lib/logger').then(({ default: logger }) => logger.error('Error loading user data', { error: (error as any)?.message || error })).catch(()=>{});
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [authState.user]);

  useEffect(() => {
    if (authState.isAuthenticated && authState.user && !isDemoUser(authState.user.id, authState.user.email)) {
      void loadUserDataFromDB();
    }
  }, [authState.isAuthenticated, authState.user, loadUserDataFromDB]);

  const createSearch = async (searchData: any): Promise<string> => {
    if (!authState.user) {
      import('../lib/logger').then(({ default: logger }) => logger.warn('User not authenticated for search creation')).catch(()=>{});
      throw new Error('User not authenticated');
    }
    
    if (import.meta.env.MODE !== 'production') {
      logger.debug('Creating search for user:', authState.user.id, authState.user.email);
    }
    
    // Check for demo user (multiple possible IDs)
    const demo = isDemoUser(authState.user.id, authState.user.email);
    
    if (demo) {
      logger.info('Demo user detected, returning mock search ID');
      return 'demo-search-id';
    }

    try {
      logger.debug('Creating real search for user:', authState.user.id);
      const search = await SearchService.createSearch(authState.user.id, {
        search_type: searchData.type,
        product_service: searchData.productService,
        industries: searchData.industries,
        countries: searchData.countries
      });

      logger.info('Search created successfully:', search.id);
      dispatch({ type: 'ADD_SEARCH', payload: search });
      try { if (typeof window !== 'undefined') window.localStorage.setItem('currentSearchId', search.id); } catch {}
      return search.id;
    } catch (error) {
      import('../lib/logger').then(({ default: logger }) => logger.error('Error creating search', { error: (error as any)?.message || error })).catch(()=>{});
      
      // If there's a network error, provide a fallback
      if (error.message?.includes('Load failed') || error.message?.includes('network')) {
        logger.warn('Network error detected, creating fallback search ID');
        // Generate a temporary search ID and add to local state
        const fallbackId = (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
          ? (crypto as any).randomUUID()
          : `tmp-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
        const fallbackSearch = {
          id: fallbackId,
          user_id: authState.user.id,
          search_type: searchData.type,
          product_service: searchData.productService,
          industries: searchData.industries,
          countries: searchData.countries,
          status: 'in_progress',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        dispatch({ type: 'ADD_SEARCH', payload: fallbackSearch });
        return fallbackId;
      }
      
      throw error;
    }
  };

  const setCurrentSearch = (searchId: string) => {
    dispatch({ type: 'SET_CURRENT_SEARCH', payload: searchId });
    try { if (typeof window !== 'undefined') window.localStorage.setItem('currentSearchId', searchId); } catch {}
  };

  const getCurrentSearch = (): UserSearch | null => {
    if (!state.currentSearchId) return null;
    return state.searchHistory.find(search => search.id === state.currentSearchId) || null;
  };

  const getSearch = (searchId: string): UserSearch | null => {
    return state.searchHistory.find(search => search.id === searchId) || null;
  };

  const loadUserData = async () => {
    await loadUserDataFromDB();
  };

  return (
    <UserDataContext.Provider
      value={{
        state,
        createSearch,
        loadUserData,
        setCurrentSearch,
        getCurrentSearch,
        getSearch
      }}
    >
      {children}
    </UserDataContext.Provider>
  );
}

export function useUserData() {
  const context = useContext(UserDataContext);
  if (context === undefined) {
    throw new Error('useUserData must be used within a UserDataProvider');
  }
  return context;
}