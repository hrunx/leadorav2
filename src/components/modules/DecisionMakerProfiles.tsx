import React, { useState, useEffect } from 'react';
import { User, Crown, Shield, Users, Mail, Phone, Linkedin, ArrowRight, Building, Eye, X, Target, TrendingUp, Search, Plus } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { useUserData } from '../../context/UserDataContext';
import { useAuth } from '../../context/AuthContext';
import { useRealTimeSearch } from '../../hooks/useRealTimeSearch';

import { DEMO_USER_ID, DEMO_USER_EMAIL, isDemoUser } from '../../constants/demo';

interface DecisionMakerPersona {
  id: string;
  title: string;
  rank: number;
  matchScore: number;
  level: 'executive' | 'director' | 'manager';
  department: string;
  influence: number;
  demographics: {
    experience: string;
    typicalTitles: string[];
    departments: string[];
    companyTypes: string[];
  };
  characteristics: {
    keyResponsibilities: string[];
    painPoints: string[];
    motivations: string[];
    decisionFactors: string[];
  };
  behaviors: {
    communicationStyle: string;
    decisionTimeline: string;
    preferredApproach: string;
    buyingInfluence: string;
  };
  marketPotential: {
    totalDecisionMakers: number;
    avgInfluence: number;
    conversionRate: string;
  };
  employees: {
    id: string;
    name: string;
    title: string;
    company: string;
    matchScore: number;
  }[];
}

interface DecisionMaker {
  id: string;
  name: string;
  title: string;
  level: 'executive' | 'director' | 'manager';
  department: string;
  influence: number;
  email: string;
  phone: string;
  linkedin: string;
  company: string;
  persona: {
    experience: string;
    priorities: string[];
    communicationStyle: string;
    decisionFactors: string[];
    painPoints: string[];
    preferredApproach: string;
  };
  recentActivity: string[];
  personaType: string;
}

const getDemoPersonas = (): DecisionMakerPersona[] => [
  {
    id: 'demo-1',
    title: 'Chief Technology Officer',
    rank: 1,
    matchScore: 95,
    level: 'executive',
    department: 'Technology',
    influence: 95,
    demographics: {
      experience: '15+ years in enterprise technology leadership',
      typicalTitles: ['CTO'],
      departments: ['Technology'],
      companyTypes: ['Enterprise']
    },
    characteristics: {
      keyResponsibilities: ['Technology strategy and vision'],
      painPoints: ['Legacy system modernization'],
      motivations: ['Drive digital transformation success'],
      decisionFactors: ['Proven ROI and business impact']
    },
    behaviors: {
      communicationStyle: 'Strategic, data-driven',
      decisionTimeline: '6-12 months',
      preferredApproach: 'Executive briefing with clear business case',
      buyingInfluence: 'Final decision maker for technology investments over $500K'
    },
    marketPotential: {
      totalDecisionMakers: 2500,
      avgInfluence: 95,
      conversionRate: '8%'
    },
    employees: [
      {
        id: '1',
        name: 'Sarah Johnson',
        title: 'Chief Technology Officer',
        company: 'TechCorp Solutions',
        matchScore: 95
      }
    ]
  }
];

export default function DecisionMakerProfiles() {
  const { state, updateSelectedPersonas } = useAppContext();
  const { getCurrentSearch } = useUserData();
  const { state: authState } = useAuth();
  const currentSearch = getCurrentSearch();
  
  // Real-time data hook for progressive loading
  const realTimeData = useRealTimeSearch(currentSearch?.id || null);
  
  // UI state
  const [selectedPersona, setSelectedPersona] = useState<DecisionMakerPersona | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedPersonas, setExpandedPersonas] = useState<string[]>([]);
  const [showEmployeeDetails, setShowEmployeeDetails] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<DecisionMaker | null>(null);
  
  // Determine if we're in demo mode
  const isDemo = isDemoUser(authState.user?.id, authState.user?.email);

  // Use real-time data for real users, demo data for demo users
  const decisionMakerPersonas = isDemo ? getDemoPersonas() : realTimeData.dmPersonas.map(p => {
    // 🎯 TARGETED DISPLAY: Get only DMs mapped to this persona with enriched contact info
    const personaDecisionMakers = realTimeData.getDecisionMakersForPersona(p.id);
    
    return {
      id: p.id,
      title: p.title,
      rank: p.rank,
      description: p.description || `Key ${p.title} decision maker profile`,
      responsibilities: p.responsibilities || [],
      painPoints: p.pain_points || [],
      preferredChannels: p.preferred_channels || [],
      keyMessages: p.key_messages || [],
      avgEmployees: personaDecisionMakers.length,
      employeeProfiles: personaDecisionMakers.map(dm => ({
        id: dm.id,
        name: dm.name,
        title: dm.title,
        company: dm.company,
        linkedin: dm.linkedin,
        email: dm.email || 'Enriching...',
        phone: dm.phone || 'Enriching...',
        bio: dm.bio || '',
        location: dm.location || '',
        matchScore: Math.min(95, Math.max(75, 90 - personaDecisionMakers.indexOf(dm) * 3)), // Dynamic scoring
        verified: dm.enrichment_status === 'completed',
        confidence: dm.enrichment_confidence || 0
      }))
    };
  });
  
  const isLoading = isDemo ? false : realTimeData.isLoading || (realTimeData.progress.phase !== 'completed' && decisionMakerPersonas.length === 0);
  const hasSearch = isDemo ? true : !!currentSearch;

  // Discovery status based on real-time progress
  const discoveryStatus = isDemo ? 'completed' :
    realTimeData.progress.phase === 'completed' ? 'completed' :
    realTimeData.progress.decision_makers_count > 0 ? 'discovering' : 'discovering';

  // Real-time progress logging
  useEffect(() => {
    if (!isDemo && currentSearch) {
      console.log(`🎯 DM Real-time data for ${currentSearch.id}:`, {
        phase: realTimeData.progress.phase,
        dmPersonas: realTimeData.dmPersonas.length,
        decisionMakers: realTimeData.progress.decision_makers_count,
        isLoading: realTimeData.isLoading
      });
    }
  }, [realTimeData, currentSearch, isDemo]);

  const [detailedEmployees] = useState<DecisionMaker[]>([
    {
      id: '1',
      name: 'Sarah Johnson',
      title: 'Chief Technology Officer',
      level: 'executive',
      department: 'Technology',
      influence: 95,
      email: 's.johnson@techcorp.com',
      phone: '+1 (555) 123-4567',
      linkedin: 'linkedin.com/in/sarahjohnson',
      company: 'TechCorp Solutions',
      persona: {
        experience: '15+ years in enterprise technology leadership',
        priorities: ['Digital transformation', 'Operational efficiency', 'Team productivity', 'Innovation'],
        communicationStyle: 'Strategic, data-driven, prefers executive summaries',
        decisionFactors: ['ROI analysis', 'Strategic alignment', 'Implementation timeline', 'Vendor stability'],
        painPoints: ['Legacy system integration', 'Budget constraints', 'Change management', 'Scalability issues'],
        preferredApproach: 'Executive briefing with clear business case and ROI projections'
      },
      recentActivity: [
        'Spoke at TechLeaders Summit 2024',
        'Announced $10M digital transformation initiative',
        'Published article on AI in enterprise'
      ],
      personaType: 'Chief Technology Officer'
    },
    // Add more detailed employees as needed...
  ]);

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
    switch (level) {
      case 'executive':
        return <Crown className="w-5 h-5 text-purple-600" />;
      case 'director':
        return <Shield className="w-5 h-5 text-blue-600" />;
      case 'manager':
        return <User className="w-5 h-5 text-green-600" />;
      default:
        return <Users className="w-5 h-5 text-gray-600" />;
    }
  };

  const togglePersonaExpansion = (personaId: string) => {
    setExpandedPersonas(prev => 
      prev.includes(personaId) 
        ? prev.filter(id => id !== personaId)
        : [...prev, personaId]
    );
  };

  const handleViewEmployeesForPersona = (persona: DecisionMakerPersona) => {
    // Filter employees by persona type and show detailed view
    const filteredEmployees = detailedEmployees.filter(emp => emp.personaType === persona.title);
    setShowEmployeeDetails(true);
    // In a real app, you'd pass this data to the next view
  };

  const handleProceedToInsights = () => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'insights' }));
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Target },
    { id: 'characteristics', label: 'Characteristics', icon: Users },
    { id: 'behaviors', label: 'Behaviors', icon: Building }
  ];

  if (showEmployeeDetails) {
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Individual Employee Profiles</h1>
            <p className="text-gray-600 mt-2">
              Detailed profiles for decision makers for "{state.searchData?.productService}"
            </p>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={() => setShowEmployeeDetails(false)}
              className="flex items-center space-x-2 px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              <X className="w-5 h-5" />
              <span>Back to Personas</span>
            </button>
            <button
              onClick={handleProceedToInsights}
              className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <span>Next: Market Insights</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Employee List */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900">Decision Maker Employees</h2>
            
            {detailedEmployees.map((employee) => (
              <div
                key={employee.id}
                onClick={() => setSelectedEmployee(employee)}
                className={`bg-white rounded-xl shadow-sm border-2 p-6 cursor-pointer transition-all hover:shadow-md ${
                  selectedEmployee?.id === employee.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-4">
                    <div className="flex-shrink-0">
                      {getLevelIcon(employee.level)}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900">{employee.name}</h3>
                      <p className="text-sm text-gray-600 mb-2">{employee.title}</p>
                      <p className="text-sm text-gray-500">{employee.company}</p>
                      <div className="flex items-center space-x-4 text-sm mt-2">
                        <span className="flex items-center space-x-1">
                          <Building className="w-4 h-4" />
                          <span>{employee.department}</span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <span>Influence: {employee.influence}%</span>
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`px-3 py-1 rounded-full text-xs font-medium border ${getMatchScoreColor(95)}`}>
                      95% Quality Match
                    </div>
                    <div className="w-20 bg-gray-200 rounded-full h-2 mt-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${employee.influence}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Employee Details */}
          <div className="sticky top-8">
            {selectedEmployee ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">{selectedEmployee.name}</h2>
                    <p className="text-gray-600 mt-1">{selectedEmployee.title}</p>
                    <p className="text-sm text-gray-500">{selectedEmployee.company}</p>
                  </div>
                  <div className={`px-4 py-2 rounded-full text-sm font-medium ${getMatchScoreColor(95)}`}>
                    95% Quality Match
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                      <Mail className="w-5 h-5 text-gray-600" />
                      <a href={`mailto:${selectedEmployee.email}`} className="text-blue-600 hover:text-blue-800">
                        {selectedEmployee.email}
                      </a>
                    </div>
                    <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                      <Phone className="w-5 h-5 text-gray-600" />
                      <a href={`tel:${selectedEmployee.phone}`} className="text-blue-600 hover:text-blue-800">
                        {selectedEmployee.phone}
                      </a>
                    </div>
                    <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                      <Linkedin className="w-5 h-5 text-gray-600" />
                      <a 
                        href={`https://${selectedEmployee.linkedin}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800"
                      >
                        LinkedIn Profile
                      </a>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3">Experience</h4>
                    <p className="text-gray-700">{selectedEmployee.persona.experience}</p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3">Key Priorities</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedEmployee.persona.priorities.map((priority, index) => (
                        <span key={index} className="px-3 py-1 bg-blue-100 text-blue-800 text-sm rounded-full">
                          {priority}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3">Pain Points</h4>
                    <ul className="space-y-2">
                      {selectedEmployee.persona.painPoints.map((point, index) => (
                        <li key={index} className="flex items-start space-x-2">
                          <div className="w-2 h-2 bg-red-500 rounded-full mt-2 flex-shrink-0"></div>
                          <span className="text-gray-700 text-sm">{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                    <h4 className="font-semibold text-blue-900 mb-2">Recommended Approach</h4>
                    <p className="text-blue-800 text-sm">{selectedEmployee.persona.preferredApproach}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
                <User className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Select an Employee</h3>
                <p className="text-gray-600">
                  Choose an employee from the list to view their detailed profile and contact information.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Show discovery progress UI for real users (always show loading for real searches)
  if (isLoading || (discoveryStatus === 'discovering' && decisionMakerPersonas.length === 0) ||
      (!isDemo && currentSearch && decisionMakerPersonas.length === 0)) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h3 className="text-lg font-semibold text-gray-900">Discovering decision makers...</h3>
          <p className="text-gray-600 mb-4">AI agents are searching LinkedIn for key decision makers at target companies</p>
          
          {/* Progress indicators */}
          <div className="space-y-2 text-sm text-gray-500">
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>Business personas generated</span>
            </div>
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>Target businesses identified</span>
            </div>
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>Decision maker personas created</span>
            </div>
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              <span>Searching LinkedIn for decision makers...</span>
            </div>
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-gray-300 rounded-full"></div>
              <span>Analyzing profiles with AI</span>
            </div>
          </div>
          
          <div className="mt-6 text-xs text-gray-400">
            Decision maker profiles will appear as soon as they're found
          </div>
        </div>
      </div>
    );
  }

  // Show empty state for real users without any searches
  if (!hasSearch && !isDemoUser(authState.user?.id, authState.user?.email)) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center max-w-md">
          <User className="w-24 h-24 text-gray-300 mx-auto mb-6" />
          <h3 className="text-2xl font-semibold text-gray-900 mb-4">No Decision Maker Profiles Yet</h3>
          <p className="text-gray-600 mb-8">
            Start a search to discover detailed profiles of decision makers who influence purchasing decisions.
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
            Top 10 Decision Maker Personas for "{state.searchData?.productService}"
          </h1>
          <p className="text-gray-600 mt-2">
            Ranked decision maker personas who influence purchasing decisions for your product/service
          </p>
        </div>
        <button
          onClick={handleProceedToInsights}
          className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <span>Next: Market Insights</span>
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Decision Maker Personas List */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Ranked Decision Maker Personas</h2>
          
          {decisionMakerPersonas.map((persona) => (
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
                      <p className="text-gray-600 mt-1">{persona.department} • {persona.level}</p>
                      <p className="text-sm text-gray-500">{persona.demographics.experience}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`px-3 py-1 rounded-full text-sm font-medium mb-2 ${getMatchScoreColor(persona.matchScore)}`}>
                      <Target className="w-4 h-4 inline mr-1" />
                      {persona.matchScore}% match
                    </div>
                    <div className="text-sm text-gray-500">
                      {persona.marketPotential.totalDecisionMakers.toLocaleString()} decision makers
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                  <div className="flex items-center space-x-2 text-gray-600">
                    <TrendingUp className="w-4 h-4" />
                    <span>{persona.influence}% avg influence</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-600">
                    <Users className="w-4 h-4" />
                    <span>{persona.marketPotential.conversionRate} conversion</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-600">
                    <Building className="w-4 h-4" />
                    <span>{persona.behaviors.decisionTimeline}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                  {persona.characteristics.painPoints.slice(0, 2).map((point, index) => (
                    <span key={index} className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full">
                      {point}
                    </span>
                  ))}
                  {persona.characteristics.painPoints.length > 2 && (
                    <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                      +{persona.characteristics.painPoints.length - 2} more
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
                    <ArrowRight className="w-4 h-4 text-gray-500 transform rotate-90 transition-transform" />
                  ) : (
                    <ArrowRight className="w-4 h-4 text-gray-500 transition-transform" />
                  )}
                </button>

                {expandedPersonas.includes(persona.id) && (
                  <div className="px-6 pb-4 bg-gray-50">
                    <div className="space-y-3">
                      {persona.employees.map((employee, index) => (
                        <div key={index} className="bg-white rounded-lg p-4 border border-gray-200 hover:border-blue-300 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <h4 className="font-medium text-gray-900">{employee.name}</h4>
                              <p className="text-sm text-gray-600">{employee.title}</p>
                              <p className="text-xs text-gray-500">{employee.company}</p>
                            </div>
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              employee.matchScore >= 90 ? 'bg-green-100 text-green-800' :
                              employee.matchScore >= 80 ? 'bg-blue-100 text-blue-800' :
                              'bg-yellow-100 text-yellow-800'
                            }`}>
                              {employee.matchScore}% match
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
                    <p className="text-gray-600 mt-1">Rank #{selectedPersona.rank} • {selectedPersona.matchScore}% Match</p>
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
                            <span className="font-semibold text-blue-900">{selectedPersona.marketPotential.totalDecisionMakers.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-blue-700">Avg Influence:</span>
                            <span className="font-semibold text-blue-900">{selectedPersona.marketPotential.avgInfluence}%</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-blue-700">Conversion Rate:</span>
                            <span className="font-semibold text-blue-900">{selectedPersona.marketPotential.conversionRate}</span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                        <h4 className="font-semibold text-green-900 mb-2">Demographics</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-green-700">Level:</span>
                            <span className="font-semibold text-green-900 capitalize">{selectedPersona.level}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-green-700">Department:</span>
                            <span className="font-semibold text-green-900">{selectedPersona.department}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-green-700">Influence:</span>
                            <span className="font-semibold text-green-900">{selectedPersona.influence}%</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-3">Key Responsibilities</h4>
                        <div className="space-y-2">
                          {selectedPersona.characteristics.keyResponsibilities.map((responsibility, index) => (
                            <div key={index} className="flex items-start space-x-2">
                              <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                              <span className="text-gray-700 text-sm">{responsibility}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h4 className="font-semibold text-gray-900 mb-3">Top Pain Points</h4>
                        <div className="space-y-2">
                          {selectedPersona.characteristics.painPoints.map((point, index) => (
                            <div key={index} className="flex items-start space-x-2">
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
                          {selectedPersona.characteristics.painPoints.map((point, index) => (
                            <div key={index} className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                              <span className="text-red-800 text-sm">{point}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                        <h4 className="font-semibold text-green-900 mb-3">Motivations</h4>
                        <div className="space-y-2">
                          {selectedPersona.characteristics.motivations.map((motivation, index) => (
                            <div key={index} className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                              <span className="text-green-800 text-sm">{motivation}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                        <h4 className="font-semibold text-blue-900 mb-3">Decision Factors</h4>
                        <div className="space-y-2">
                          {selectedPersona.characteristics.decisionFactors.map((factor, index) => (
                            <div key={index} className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                              <span className="text-blue-800 text-sm">{factor}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-purple-50 rounded-xl p-4 border border-purple-200">
                        <h4 className="font-semibold text-purple-900 mb-3">Key Responsibilities</h4>
                        <div className="space-y-2">
                          {selectedPersona.characteristics.keyResponsibilities.slice(0, 4).map((responsibility, index) => (
                            <div key={index} className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                              <span className="text-purple-800 text-sm">{responsibility}</span>
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
                          <h4 className="font-semibold text-gray-900 mb-2">Communication Style</h4>
                          <p className="text-gray-700 text-sm">{selectedPersona.behaviors.communicationStyle}</p>
                        </div>

                        <div className="bg-white border border-gray-200 rounded-xl p-4">
                          <h4 className="font-semibold text-gray-900 mb-2">Decision Timeline</h4>
                          <p className="text-gray-700 text-sm">{selectedPersona.behaviors.decisionTimeline}</p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="bg-white border border-gray-200 rounded-xl p-4">
                          <h4 className="font-semibold text-gray-900 mb-2">Preferred Approach</h4>
                          <p className="text-gray-700 text-sm">{selectedPersona.behaviors.preferredApproach}</p>
                        </div>

                        <div className="bg-white border border-gray-200 rounded-xl p-4">
                          <h4 className="font-semibold text-gray-900 mb-2">Buying Influence</h4>
                          <p className="text-gray-700 text-sm">{selectedPersona.behaviors.buyingInfluence}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
              <Target className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Decision Maker Persona</h3>
              <p className="text-gray-600">
                Choose a persona from the ranked list to view detailed characteristics and employee profiles.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}