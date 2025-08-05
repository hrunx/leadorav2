import React, { createContext, useContext, useReducer, ReactNode } from 'react';

interface SearchData {
  type: 'customer' | 'supplier';
  productService: string;
  industries: string[];
  countries: string[];
  timestamp: string;
}

interface ICPData {
  demographics: {
    industry: string;
    companySize: string;
    geography: string;
    revenue: string;
  };
  psychographics: {
    painPoints: string[];
    motivations: string[];
    challenges: string[];
  };
  behaviors: {
    decisionMaking: string;
    buyingProcess: string;
    preferredChannels: string[];
  };
}

interface ISPData {
  profile: {
    experience: string;
    skills: string[];
    territory: string;
    performanceMetrics: string[];
  };
  characteristics: {
    communication: string;
    salesApproach: string;
    industryKnowledge: string;
  };
}

interface AppState {
  searchData: SearchData | null;
  icpData: ICPData;
  ispData: ISPData;
  decisionMakers: any[];
  companies: any[];
  marketInsights: any;
  gtmStrategy: any;
  emailCampaigns: any[];
  selectedPersonas: any[];
  selectedDecisionMakerPersonas: any[];
}

interface AppContextType {
  state: AppState;
  updateSearchData: (data: SearchData) => void;
  updateICP: (data: Partial<ICPData>) => void;
  updateISP: (data: Partial<ISPData>) => void;
  updateDecisionMakers: (data: any[]) => void;
  updateCompanies: (data: any[]) => void;
  updateMarketInsights: (data: any) => void;
  updateGTMStrategy: (data: any) => void;
  updateEmailCampaigns: (data: any[]) => void;
  updateSelectedPersonas: (data: any[]) => void;
  updateSelectedDecisionMakerPersonas: (data: any[]) => void;
}

const initialState: AppState = {
  searchData: null,
  icpData: {
    demographics: {
      industry: '',
      companySize: '',
      geography: '',
      revenue: ''
    },
    psychographics: {
      painPoints: [],
      motivations: [],
      challenges: []
    },
    behaviors: {
      decisionMaking: '',
      buyingProcess: '',
      preferredChannels: []
    }
  },
  ispData: {
    profile: {
      experience: '',
      skills: [],
      territory: '',
      performanceMetrics: []
    },
    characteristics: {
      communication: '',
      salesApproach: '',
      industryKnowledge: ''
    }
  },
  decisionMakers: [],
  companies: [],
  marketInsights: null,
  gtmStrategy: null,
  emailCampaigns: [],
  selectedPersonas: [],
  selectedDecisionMakerPersonas: []
};

const AppContext = createContext<AppContextType | undefined>(undefined);

function appReducer(state: AppState, action: any): AppState {
  switch (action.type) {
    case 'UPDATE_SEARCH_DATA':
      return {
        ...state,
        searchData: action.payload
      };
    case 'UPDATE_ICP':
      return {
        ...state,
        icpData: { ...state.icpData, ...action.payload }
      };
    case 'UPDATE_ISP':
      return {
        ...state,
        ispData: { ...state.ispData, ...action.payload }
      };
    case 'UPDATE_DECISION_MAKERS':
      return {
        ...state,
        decisionMakers: action.payload
      };
    case 'UPDATE_COMPANIES':
      return {
        ...state,
        companies: action.payload
      };
    case 'UPDATE_MARKET_INSIGHTS':
      return {
        ...state,
        marketInsights: action.payload
      };
    case 'UPDATE_GTM_STRATEGY':
      return {
        ...state,
        gtmStrategy: action.payload
      };
    case 'UPDATE_EMAIL_CAMPAIGNS':
      return {
        ...state,
        emailCampaigns: action.payload
      };
    case 'UPDATE_SELECTED_PERSONAS':
      return {
        ...state,
        selectedPersonas: action.payload
      };
    case 'UPDATE_SELECTED_DECISION_MAKER_PERSONAS':
      return {
        ...state,
        selectedDecisionMakerPersonas: action.payload
      };
    default:
      return state;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  const updateSearchData = (data: SearchData) => {
    dispatch({ type: 'UPDATE_SEARCH_DATA', payload: data });
  };

  const updateICP = (data: Partial<ICPData>) => {
    dispatch({ type: 'UPDATE_ICP', payload: data });
  };

  const updateISP = (data: Partial<ISPData>) => {
    dispatch({ type: 'UPDATE_ISP', payload: data });
  };

  const updateDecisionMakers = (data: any[]) => {
    dispatch({ type: 'UPDATE_DECISION_MAKERS', payload: data });
  };

  const updateCompanies = (data: any[]) => {
    dispatch({ type: 'UPDATE_COMPANIES', payload: data });
  };

  const updateMarketInsights = (data: any) => {
    dispatch({ type: 'UPDATE_MARKET_INSIGHTS', payload: data });
  };

  const updateGTMStrategy = (data: any) => {
    dispatch({ type: 'UPDATE_GTM_STRATEGY', payload: data });
  };

  const updateEmailCampaigns = (data: any[]) => {
    dispatch({ type: 'UPDATE_EMAIL_CAMPAIGNS', payload: data });
  };

  const updateSelectedPersonas = (data: any[]) => {
    dispatch({ type: 'UPDATE_SELECTED_PERSONAS', payload: data });
  };

  const updateSelectedDecisionMakerPersonas = (data: any[]) => {
    dispatch({ type: 'UPDATE_SELECTED_DECISION_MAKER_PERSONAS', payload: data });
  };

  return (
    <AppContext.Provider
      value={{
        state,
        updateSearchData,
        updateICP,
        updateISP,
        updateDecisionMakers,
        updateCompanies,
        updateMarketInsights,
        updateGTMStrategy,
        updateEmailCampaigns,
        updateSelectedPersonas,
        updateSelectedDecisionMakerPersonas
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}