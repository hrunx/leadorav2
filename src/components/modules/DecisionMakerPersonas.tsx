import { useState, useEffect } from 'react';
import { UserCheck, Crown, Shield, User, Users, Target, TrendingUp, DollarSign, Star, ArrowRight, ChevronDown, ChevronUp, Eye, Plus } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { useUserData } from '../../context/UserDataContext';
import { useAuth } from '../../context/AuthContext';
import { useRealTimeSearch } from '../../hooks/useRealTimeSearch';
import type { DecisionMakerPersona as BackendDecisionMakerPersona, DecisionMaker } from '../../lib/supabase';

// Extend the backend type for UI use
interface DecisionMakerEmployee {
  id: string;
  name: string;
  title: string;
  company: string;
  match_score: number;
}

interface UIDecisionMakerPersona extends BackendDecisionMakerPersona {
  employees: DecisionMakerEmployee[];
}

const getDemoPersona = (): UIDecisionMakerPersona => ({
  id: 'demo-persona-1',
  search_id: 'demo-search',
  user_id: 'demo-user',
  title: 'Chief Technology Officer',
  rank: 1,
  match_score: 95,
  demographics: {
    level: 'C-Level Executive',
    department: 'Technology',
    experience: '15+ years',
    geography: 'North America, Europe',
  },
  characteristics: {
    responsibilities: ['Technology strategy and vision', 'Digital transformation leadership', 'Technology budget allocation', 'Vendor relationship management'],
    painPoints: ['Legacy system modernization', 'Cybersecurity threats', 'Talent acquisition', 'Technology ROI measurement'],
    motivations: ['Innovation leadership', 'Competitive advantage', 'Operational efficiency', 'Business growth enablement'],
    challenges: ['Budget constraints', 'Rapid technology changes', 'Integration complexity', 'Change management'],
    decisionFactors: ['Strategic alignment', 'Scalability', 'Security', 'Vendor stability'],
  },
  behaviors: {
    decisionMaking: 'Strategic, data-driven with long-term vision',
    communicationStyle: 'High-level strategic discussions with technical depth when needed',
    buyingProcess: 'Committee-based with 6-12 month evaluation cycles',
    preferredChannels: ['Executive briefings', 'Industry conferences', 'Peer networks', 'Analyst reports'],
  },
  market_potential: {
    totalDecisionMakers: 2500,
    avgInfluence: '95%',
    conversionRate: '8%',
  },
  created_at: '',
  employees: [
    { id: '1', name: 'Sarah Johnson', title: 'Chief Technology Officer', company: 'TechCorp Solutions', match_score: 95 },
    { id: '2', name: 'Michael Chen', title: 'CTO', company: 'InnovateTech Inc', match_score: 92 },
    { id: '3', name: 'David Rodriguez', title: 'Chief Technology Officer', company: 'HealthTech Innovations', match_score: 90 },
    { id: '4', name: 'Lisa Wang', title: 'CTO', company: 'Global Manufacturing Corp', match_score: 88 },
    { id: '5', name: 'James Thompson', title: 'Chief Technology Officer', company: 'Financial Services Group', match_score: 85 },
  ],
});

function toDecisionMakerPersona(p: Record<string, unknown>, getDecisionMakersForPersona: (id: string) => DecisionMaker[]): UIDecisionMakerPersona {
  return {
    id: p.id as string,
    search_id: (p.search_id as string) || '',
    user_id: (p.user_id as string) || '',
    title: (p.title as string) || '',
    rank: typeof p.rank === 'number' ? (p.rank as number) : 1,
    match_score: typeof p.match_score === 'number' ? (p.match_score as number) : (typeof p.matchScore === 'number' ? (p.matchScore as number) : 85),
    demographics: (p.demographics as Record<string, unknown>) || {},
    characteristics: (p.characteristics as Record<string, unknown>) || {},
    behaviors: (p.behaviors as Record<string, unknown>) || {},
    market_potential: (p.market_potential as Record<string, unknown>) || {},
    created_at: (p.created_at as string) || '',
    employees: (getDecisionMakersForPersona(p.id as string) || []).map((dm: DecisionMaker, idx: number): DecisionMakerEmployee => {
      const baseId = dm.business_id || dm.id || '';
      return {
        id: baseId ? `${baseId}-${idx}` : `employee-${idx}`,
        name: dm.name || '',
        title: dm.title || '',
        company: dm.company || '',
        match_score: typeof dm.match_score === 'number' ? dm.match_score : 85,
      };
    }),
  };
}

// Helper type guards/casters
function asMarketPotential(obj: unknown): { totalDecisionMakers?: number; avgInfluence?: string; conversionRate?: string } {
  return (typeof obj === 'object' && obj !== null) ? obj as any : {};
}
function asCharacteristics(obj: unknown): { responsibilities?: string[]; painPoints?: string[]; motivations?: string[]; challenges?: string[]; decisionFactors?: string[] } {
  return (typeof obj === 'object' && obj !== null) ? obj as any : {};
}
function asBehaviors(obj: unknown): { decisionMaking?: string; communicationStyle?: string; buyingProcess?: string; preferredChannels?: string[] } {
  return (typeof obj === 'object' && obj !== null) ? obj as any : {};
}

export default function DecisionMakerPersonas() {
  const { state, updateSelectedDecisionMakerPersonas } = useAppContext();
  const { getCurrentSearch } = useUserData();
  const { state: authState } = useAuth();
  const currentSearch = getCurrentSearch();
  
  // Real-time data hook for progressive loading
  const realTimeData = useRealTimeSearch(currentSearch?.id || null);
  
  // UI state
  const [selectedPersona, setSelectedPersona] = useState<UIDecisionMakerPersona | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedPersonas, setExpandedPersonas] = useState<string[]>([]);
  
  // Determine if we're in demo mode
  const isDemo = authState.user?.id === 'demo' && authState.user?.email === 'demo@example.com';
  
  // Refactor demo persona logic: personas is always strictly DecisionMakerPersona[] for both demo and real users
  // Ensure all property accesses are safe and match the unified interface
  const personas: UIDecisionMakerPersona[] = isDemo
    ? [getDemoPersona()]
    : Array.isArray(realTimeData.dmPersonas)
      ? realTimeData.dmPersonas.map((p: any) => toDecisionMakerPersona(p, realTimeData.getDecisionMakersForPersona))
      : [];
  
  const isLoading = isDemo ? false : realTimeData.isLoading || (realTimeData.progress.phase !== 'completed' && personas.length === 0);
  const hasSearch = isDemo ? true : !!currentSearch;

  // Load demo data for demo users only
  useEffect(() => {
    if (isDemo) {
      // The original getStaticDMPersonas function was removed, so we'll just set a single demo persona
      // This will cause a type error if the persona structure is not exactly as DecisionMakerPersona
      // but the instruction was to remove getStaticDMPersonas and getStaticPersonas.
      // For now, we'll set a single demo persona.
      // setDemoPersonas([getDemoPersona()]); // This line was removed as per the edit hint.
    }
  }, [isDemo]);

  const getMatchScoreColor = (score: number) => {
    if (score >= 90) return 'text-green-600 bg-green-100';
    if (score >= 80) return 'text-blue-600 bg-blue-100';
    if (score >= 70) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  const getRankColor = (rank: number) => {
    if (rank <= 3) return 'bg-gradient-to-r from-yellow-400 to-yellow-600';
    if (rank <= 6) return 'bg-gradient-to-r from-gray-400 to-gray-600';
    return 'bg-gradient-to-r from-orange-400 to-orange-600';
  };

  const getLevelIcon = (level: string) => {
    if (level.includes('C-Level')) return <Crown className="w-5 h-5 text-purple-600" />;
    if (level.includes('VP')) return <Shield className="w-5 h-5 text-blue-600" />;
    return <User className="w-5 h-5 text-green-600" />;
  };

  const togglePersonaExpansion = (personaId: string) => {
    setExpandedPersonas(prev => 
      prev.includes(personaId) 
        ? prev.filter(id => id !== personaId)
        : [...prev, personaId]
    );
  };

  const handleProceedToDecisionMakers = () => {
    updateSelectedDecisionMakerPersonas(personas);
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'decision-makers' }));
  };

  const handleViewEmployeesForPersona = (persona: UIDecisionMakerPersona) => {
    updateSelectedDecisionMakerPersonas([persona]);
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'decision-makers' }));
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Target },
    { id: 'characteristics', label: 'Characteristics', icon: Users },
    { id: 'behaviors', label: 'Behaviors', icon: UserCheck }
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h3 className="text-lg font-semibold text-gray-900">Generating decision maker personas...</h3>
          <p className="text-gray-600">AI agents are analyzing decision maker profiles for your search</p>
        </div>
      </div>
    );
  }

  // Show empty state for real users without any searches
  if (!hasSearch && !isDemo) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center max-w-md">
          <UserCheck className="w-24 h-24 text-gray-300 mx-auto mb-6" />
          <h3 className="text-2xl font-semibold text-gray-900 mb-4">No Decision Maker Personas Yet</h3>
          <p className="text-gray-600 mb-8">
            Start a search to discover and analyze decision maker personas that influence purchasing decisions.
          </p>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('navigate', { detail: 'search' }))}
            className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            <span>Start New Search</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Decision Maker Personas for "{state.searchData?.productService}"
          </h1>
          <p className="text-gray-600 mt-2">
            Ranked decision maker personas for businesses {state.searchData?.type === 'customer' ? 'needing' : 'providing'} your product/service
          </p>
        </div>
        <button
          onClick={handleProceedToDecisionMakers}
          className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <span>Next: View Decision Makers</span>
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Personas List */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Ranked Decision Maker Personas</h2>
          
          {personas.map((persona) => (
            <div key={persona.id} className="bg-white rounded-xl shadow-sm border border-gray-200">
              <div
                onClick={() => setSelectedPersona(persona)}
                className={`p-6 cursor-pointer transition-all hover:shadow-md ${
                  selectedPersona?.id === persona.id ? 'bg-blue-50 border-blue-200' : ''
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start space-x-4">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold ${getRankColor(persona.rank)}`}>
                      #{persona.rank}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 text-lg">{persona.title}</h3>
                      <p className="text-gray-600 mt-1">{typeof persona.demographics?.level === 'string' ? persona.demographics.level : 'N/A'} • {typeof persona.demographics?.department === 'string' ? persona.demographics.department : 'General'}</p>
                      <p className="text-sm text-gray-500">{typeof persona.demographics?.experience === 'string' ? persona.demographics.experience : 'Unknown'} • {typeof persona.demographics?.geography === 'string' ? persona.demographics.geography : 'Global'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`px-3 py-1 rounded-full text-sm font-medium mb-2 ${getMatchScoreColor(persona.match_score)}`}>
                      <Star className="w-4 h-4 inline mr-1" />
                      {persona.match_score}% match
                    </div>
                    <div className="text-sm text-gray-500">
                      {typeof asMarketPotential(persona.market_potential)?.totalDecisionMakers === 'number' ? asMarketPotential(persona.market_potential)?.totalDecisionMakers?.toLocaleString() ?? 'N/A' : 'N/A'} decision makers
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                  <div className="flex items-center space-x-2 text-gray-600">
                    <TrendingUp className="w-4 h-4" />
                    <span>{typeof asMarketPotential(persona.market_potential)?.avgInfluence === 'string' ? asMarketPotential(persona.market_potential)?.avgInfluence : 'N/A'} avg influence</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-600">
                    <DollarSign className="w-4 h-4" />
                    <span>{typeof asMarketPotential(persona.market_potential)?.conversionRate === 'string' ? asMarketPotential(persona.market_potential)?.conversionRate : 'N/A'} conversion</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-600">
                    {getLevelIcon(typeof persona.demographics?.level === 'string' ? persona.demographics.level : 'executive')}
                    <span>{typeof persona.demographics?.level === 'string' ? persona.demographics.level : 'N/A'}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                  {Array.isArray(asCharacteristics(persona.characteristics)?.painPoints) && asCharacteristics(persona.characteristics)?.painPoints?.slice(0, 2).map((point: string) => (
                    <span key={`${persona.id}-pain-${point.slice(0, 20)}`} className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full">
                      {point}
                    </span>
                  ))}
                  {Array.isArray(asCharacteristics(persona.characteristics)?.painPoints) && (asCharacteristics(persona.characteristics)?.painPoints?.length ?? 0) > 2 && (
                    <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                      +{(asCharacteristics(persona.characteristics)?.painPoints?.length ?? 0) - 2} more
                    </span>
                  )}
                </div>
              </div>

              {/* Employee Preview Dropdown */}
              <div className="border-t border-gray-200">
                <button
                  onClick={() => togglePersonaExpansion(persona.id)}
                  className="w-full flex items-center justify-between px-6 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center space-x-2">
                    <Eye className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700">
                      View Employees ({persona.employees.length} top matches)
                    </span>
                  </div>
                  {expandedPersonas.includes(persona.id) ? (
                    <ChevronUp className="w-4 h-4 text-gray-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                  )}
                </button>

                {expandedPersonas.includes(persona.id) && (
                  <div className="px-6 pb-4 bg-gray-50">
                    <div className="space-y-3">
                      {persona.employees.map((employee) => (
                        <div key={employee.id} className="bg-white rounded-lg p-4 border border-gray-200 hover:border-blue-300 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <h4 className="font-medium text-gray-900">{employee.name}</h4>
                              <p className="text-sm text-gray-600">{employee.title}</p>
                              <p className="text-xs text-gray-500">{employee.company}</p>
                            </div>
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              employee.match_score >= 90 ? 'bg-green-100 text-green-800' :
                              employee.match_score >= 80 ? 'bg-blue-100 text-blue-800' :
                              'bg-yellow-100 text-yellow-800'
                            }`}>
                              {employee.match_score}% match
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 pt-3 border-t border-gray-200">
                      <button
                        onClick={() => handleViewEmployeesForPersona(persona)}
                        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                      >
                        View All Employees for {persona.title}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Persona Details */}
        <div className="sticky top-8">
          {selectedPersona ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="border-b border-gray-200">
                <nav className="flex space-x-6 px-6">
                  {tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center space-x-2 py-4 border-b-2 font-medium transition-colors ${
                          isActive
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </nav>
              </div>

              <div className="p-6">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">{selectedPersona.title}</h2>
                    <p className="text-gray-600 mt-1">Rank #{selectedPersona.rank} • {selectedPersona.match_score}% Match</p>
                  </div>
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-xl ${getRankColor(selectedPersona.rank)}`}>
                    #{selectedPersona.rank}
                  </div>
                </div>

                {activeTab === 'overview' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                        <h4 className="font-semibold text-blue-900 mb-2">Market Potential</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-blue-700">Total Decision Makers:</span>
                            <span className="font-semibold text-blue-900">{typeof asMarketPotential(selectedPersona.market_potential)?.totalDecisionMakers === 'number' ? asMarketPotential(selectedPersona.market_potential)?.totalDecisionMakers?.toLocaleString() ?? 'N/A' : 'N/A'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-blue-700">Avg Influence:</span>
                            <span className="font-semibold text-blue-900">{typeof asMarketPotential(selectedPersona.market_potential)?.avgInfluence === 'string' ? asMarketPotential(selectedPersona.market_potential)?.avgInfluence : 'N/A'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-blue-700">Conversion Rate:</span>
                            <span className="font-semibold text-blue-900">{typeof asMarketPotential(selectedPersona.market_potential)?.conversionRate === 'string' ? asMarketPotential(selectedPersona.market_potential)?.conversionRate : 'N/A'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                        <h4 className="font-semibold text-green-900 mb-2">Demographics</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-green-700">Level:</span>
                            <span className="font-semibold text-green-900">{typeof selectedPersona.demographics?.level === 'string' ? selectedPersona.demographics.level : 'N/A'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-green-700">Department:</span>
                            <span className="font-semibold text-green-900">{typeof selectedPersona.demographics?.department === 'string' ? selectedPersona.demographics.department : 'General'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-green-700">Experience:</span>
                            <span className="font-semibold text-green-900">{typeof selectedPersona.demographics?.experience === 'string' ? selectedPersona.demographics.experience : 'Unknown'}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-3">Key Responsibilities</h4>
                        <div className="space-y-2">
                          {asCharacteristics(selectedPersona.characteristics)?.responsibilities?.map((responsibility: string) => (
                            <div key={`${selectedPersona.id}-resp-${responsibility.slice(0, 20)}`} className="flex items-start space-x-2">
                              <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                              <span className="text-gray-700 text-sm">{responsibility}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h4 className="font-semibold text-gray-900 mb-3">Top Pain Points</h4>
                        <div className="space-y-2">
                          {Array.isArray(asCharacteristics(selectedPersona.characteristics)?.painPoints) && asCharacteristics(selectedPersona.characteristics)?.painPoints?.map((point: string) => (
                            <div key={`${selectedPersona.id}-detail-pain-${point.slice(0, 20)}`} className="flex items-start space-x-2">
                              <div className="w-2 h-2 bg-red-500 rounded-full mt-2 flex-shrink-0"></div>
                              <span className="text-gray-700 text-sm">{point}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'characteristics' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="bg-red-50 rounded-xl p-4 border border-red-200">
                        <h4 className="font-semibold text-red-900 mb-3">Pain Points</h4>
                        <div className="space-y-2">
                          {Array.isArray(asCharacteristics(selectedPersona?.characteristics)?.painPoints) ? asCharacteristics(selectedPersona?.characteristics)?.painPoints?.map((point: string) => (
                            <div key={`${selectedPersona.id}-char-pain-${point.slice(0, 20)}`} className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                              <span className="text-red-800 text-sm">{point}</span>
                            </div>
                          )) : null}
                        </div>
                      </div>

                      <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                        <h4 className="font-semibold text-green-900 mb-3">Motivations</h4>
                        <div className="space-y-2">
                          {Array.isArray(asCharacteristics(selectedPersona.characteristics)?.motivations) && asCharacteristics(selectedPersona.characteristics)?.motivations?.map((motivation: string) => (
                            <div key={`${selectedPersona.id}-char-motivation-${motivation.slice(0, 20)}`} className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                              <span className="text-green-800 text-sm">{motivation}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-yellow-50 rounded-xl p-4 border border-yellow-200">
                        <h4 className="font-semibold text-yellow-900 mb-3">Challenges</h4>
                        <div className="space-y-2">
                          {Array.isArray(asCharacteristics(selectedPersona.characteristics)?.challenges) && asCharacteristics(selectedPersona.characteristics)?.challenges?.map((challenge: string) => (
                            <div key={`${selectedPersona.id}-char-challenge-${challenge.slice(0, 20)}`} className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                              <span className="text-yellow-800 text-sm">{challenge}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                        <h4 className="font-semibold text-blue-900 mb-3">Decision Factors</h4>
                        <div className="space-y-2">
                          {Array.isArray(asCharacteristics(selectedPersona.characteristics)?.decisionFactors) && asCharacteristics(selectedPersona.characteristics)?.decisionFactors?.map((factor: string) => (
                            <div key={`${selectedPersona.id}-char-factor-${factor.slice(0, 20)}`} className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                              <span className="text-blue-800 text-sm">{factor}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'behaviors' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div className="bg-white border border-gray-200 rounded-xl p-4">
                          <h4 className="font-semibold text-gray-900 mb-2">Decision Making</h4>
                          <p className="text-gray-700 text-sm">{asBehaviors(selectedPersona.behaviors)?.decisionMaking}</p>
                        </div>

                        <div className="bg-white border border-gray-200 rounded-xl p-4">
                          <h4 className="font-semibold text-gray-900 mb-2">Communication Style</h4>
                          <p className="text-gray-700 text-sm">{asBehaviors(selectedPersona.behaviors)?.communicationStyle}</p>
                        </div>

                        <div className="bg-white border border-gray-200 rounded-xl p-4">
                          <h4 className="font-semibold text-gray-900 mb-2">Buying Process</h4>
                          <p className="text-gray-700 text-sm">{asBehaviors(selectedPersona.behaviors)?.buyingProcess}</p>
                        </div>
                      </div>

                      <div>
                        <div className="bg-white border border-gray-200 rounded-xl p-4">
                          <h4 className="font-semibold text-gray-900 mb-3">Preferred Channels</h4>
                          <div className="space-y-2">
                            {Array.isArray(asBehaviors(selectedPersona.behaviors)?.preferredChannels) && asBehaviors(selectedPersona.behaviors)?.preferredChannels?.map((channel: string) => (
                              <div key={`${selectedPersona.id}-channel-${channel.slice(0, 20)}`} className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                                <span className="text-gray-700 text-sm">{channel}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
              <UserCheck className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Decision Maker Persona</h3>
              <p className="text-gray-600">
                Choose a persona from the ranked list to view detailed characteristics and market potential.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}