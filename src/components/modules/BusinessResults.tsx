import React, { useState, useEffect } from 'react';
import { Building, MapPin, Users, DollarSign, Star, ArrowRight, Filter, Target, Search, Plus } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { useUserData } from '../../context/UserDataContext';
import { useAuth } from '../../context/AuthContext';
import { SearchService } from '../../services/searchService';
import { useDemoMode } from '../../hooks/useDemoMode';
import { useRealTimeSearch } from '../../hooks/useRealTimeSearch';
import { supabase } from '../../lib/supabase';

import { DEMO_USER_ID, DEMO_USER_EMAIL, isDemoUser } from '../../constants/demo';

interface Business {
  id: string;
  name: string;
  industry: string;
  country: string;
  city: string;
  size: string;
  revenue: string;
  description: string;
  matchScore: number;
  relevantDepartments: string[];
  keyProducts: string[];
  recentActivity: string[];
  personaType: string; // Which persona this business matches
}

export default function BusinessResults() {
  const { state } = useAppContext();
  const { getCurrentSearch } = useUserData();
  const { state: authState } = useAuth();
  const currentSearch = getCurrentSearch();
  
  // Real-time data hook for progressive loading
  const realTimeData = useRealTimeSearch(currentSearch?.id || null);
  
  // UI state
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [filterCountry, setFilterCountry] = useState('');
  const [filterIndustry, setFilterIndustry] = useState('');
  const [filterPersona, setFilterPersona] = useState('');
  
  // Legacy state for demo users
  const [demoBusinesses, setDemoBusinesses] = useState<Business[]>([]);
  const [isLoadingDemo, setIsLoadingDemo] = useState(true);
  
  // Determine if we're in demo mode
  const isDemo = isDemoUser(authState.user?.id, authState.user?.email);
  
  // Use real-time data for real users, demo data for demo users
  const businesses = isDemo ? demoBusinesses : realTimeData.businesses.map(b => ({
    id: b.id,
    name: b.name,
    industry: b.industry,
    country: b.country,
    city: b.city,
    size: b.size || 'Unknown',
    revenue: b.revenue || 'Unknown',
    description: b.description || `${b.name} operates in the ${b.industry} industry.`,
    matchScore: b.match_score || 85,
    relevantDepartments: b.relevant_departments || ['Sales', 'Marketing'],
    keyProducts: b.key_products || [],
    recentActivity: b.recent_activity || [],
    personaType: b.persona_type || 'General',
    address: b.address,
    phone: b.phone,
    website: b.website,
    rating: b.rating
  }));
  
  const isLoading = isDemo ? isLoadingDemo : realTimeData.isLoading || (realTimeData.progress.phase !== 'completed' && businesses.length === 0);
  const hasSearch = isDemo ? demoBusinesses.length > 0 : !!currentSearch;
  
  // Discovery status based on real-time progress
  const discoveryStatus = isDemo ? 'completed' : 
    realTimeData.progress.phase === 'completed' ? 'completed' :
    businesses.length > 0 ? 'discovering' : 'discovering';

  // Check if we came from a specific persona selection
  useEffect(() => {
    if (state.selectedPersonas && state.selectedPersonas.length === 1) {
      setFilterPersona(state.selectedPersonas[0].title);
    }
  }, [state.selectedPersonas]);

  // Load demo data for demo users only
  useEffect(() => {
    if (isDemo) {
      setDemoBusinesses(getStaticBusinesses());
      setIsLoadingDemo(false);
    }
  }, [isDemo]);

  // Function to check orchestration progress
  const checkDiscoveryProgress = async (searchId: string) => {
    try {
      const response = await fetch('/.netlify/functions/check-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search_id: searchId })
      });
      
      if (response.ok) {
        const result = await response.json();
        const progress = result.progress;
        const dataCounts = result.data_counts;
        
        console.log(`Discovery progress: ${progress?.phase}, Businesses found: ${dataCounts?.businesses || 0}`);
        
        // Handle offline/fallback search state
        if (progress?.phase === 'offline') {
          console.log('Offline search detected, stopping progress checks');
          setDiscoveryStatus('completed');
          setIsLoading(false);
          return;
        }
        
        // Update discovery status based on progress and data
        if (dataCounts?.businesses > 0) {
          setDiscoveryStatus('completed');
          setIsLoading(false);
          // Reload businesses if we have new ones - but don't let it override loading state
          const currentSearch = getCurrentSearch();
          if (currentSearch) {
            SearchService.getBusinesses(currentSearch.id).then(dbBusinesses => {
              const formattedBusinesses = dbBusinesses.map(business => ({
                ...business,
                matchScore: business.match_score,
                relevantDepartments: business.relevant_departments || [],
                keyProducts: business.key_products || [],
                recentActivity: business.recent_activity || [],
                personaType: business.persona_type
              }));
              setBusinesses(formattedBusinesses);
              // hasSearch should already be true since we have a search
            });
          }
        } else if (progress?.phase === 'completed') {
          setDiscoveryStatus('completed');
          setIsLoading(false);
        } else if (progress?.phase === 'starting_discovery' || progress?.phase === 'personas' || progress?.phase === 'businesses') {
          setDiscoveryStatus('discovering');
          // Don't override loading state if we're actively discovering
          if (!isLoading) {
            setIsLoading(true);
          }
          // Keep checking progress
          setTimeout(() => checkDiscoveryProgress(searchId), 2000);
        } else {
          // Keep checking for a reasonable time
          setTimeout(() => checkDiscoveryProgress(searchId), 3000);
        }
      }
    } catch (error) {
      console.error('Error checking discovery progress:', error);
      // Fallback - stop checking after a while
      setTimeout(() => setDiscoveryStatus('completed'), 10000);
    }
  };

  // Real-time subscription for streaming newly inserted businesses
  useEffect(() => {
    const currentSearch = getCurrentSearch();
    if (!currentSearch) return;
    
    const channel = supabase
      .channel('businesses-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'businesses',
          filter: `search_id=eq.${currentSearch.id}`
        },
        (payload) => {
          const b = payload.new;
          setBusinesses(prev => [
            ...prev,
            {
              ...b,
              matchScore: b.match_score,
              relevantDepartments: b.relevant_departments || [],
              keyProducts: b.key_products || [],
              recentActivity: b.recent_activity || [],
              personaType: b.persona_type
            }
          ]);
          
          // Update discovery status when first business appears
          setDiscoveryStatus('completed');
          setIsLoading(false);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [getCurrentSearch]);

  const loadBusinesses = async () => {
    setIsLoading(true);
    try {
      const currentSearch = getCurrentSearch();
      const isDemo = isDemoUser(authState.user?.id, authState.user?.email);
      
      // For demo users, use static data
      if (isDemo) {
        setBusinesses(getStaticBusinesses());
        setHasSearch(true);
        setIsLoading(false);
      } else if (!currentSearch) {
        // Real user with no search - show empty state
        setBusinesses([]);
        setHasSearch(false);
        setIsLoading(false);
      } else {
        // Real user with search - always mark hasSearch as true since a search exists
        setHasSearch(true);
        
        let dbBusinesses = await SearchService.getBusinesses(currentSearch.id);
        
        if (dbBusinesses.length === 0) {
          // Check if search is recent (less than 5 minutes old) - might still be processing
          const searchAge = Date.now() - new Date(currentSearch.created_at).getTime();
          const isRecentSearch = searchAge < 5 * 60 * 1000; // 5 minutes
          
          if (isRecentSearch) {
            console.log(`Search ${currentSearch.id} is recent and still processing businesses...`);
            // Keep loading state for recent searches and start progress checking
            setIsLoading(true);
            setDiscoveryStatus('discovering');
            // Start progress checking
            checkDiscoveryProgress(currentSearch.id);
            // Check again in a few seconds
            setTimeout(() => loadBusinesses(), 3000);
            return;
          } else {
            console.log(`No businesses found for completed search ${currentSearch.id}`);
            // Search is completed but no businesses found - show empty results, not empty state
            setBusinesses([]);
            setIsLoading(false);
            return;
          }
        }
        
        // Convert database format to component format
        const formattedBusinesses = dbBusinesses.map(business => ({
          ...business,
          matchScore: business.match_score,
          relevantDepartments: business.relevant_departments || [],
          keyProducts: business.key_products || [],
          recentActivity: business.recent_activity || [],
          personaType: business.persona_type
        }));
        
        setBusinesses(formattedBusinesses);
        setIsLoading(false); // Only stop loading when we have results or confirmed no results
      }
    } catch (error) {
      console.error('Error loading businesses:', error);
      setBusinesses([]);
      setHasSearch(false);
      setIsLoading(false);
    }
    // Note: No finally block - we manage loading state manually for recent searches
  };

  const getStaticBusinesses = (): Business[] => [
    {
      id: '1',
      name: 'TechCorp Solutions',
      industry: 'Technology',
      country: 'United States',
      city: 'San Francisco',
      size: '2500 employees',
      revenue: '$250M',
      description: 'Leading enterprise software company specializing in AI-powered business solutions',
      matchScore: 95,
      relevantDepartments: ['IT Department', 'Digital Transformation', 'Operations'],
      keyProducts: ['Enterprise Software', 'AI Solutions', 'Cloud Services'],
      recentActivity: [
        'Launched new AI platform',
        'Expanded to European markets',
        'Raised $50M Series C funding'
      ],
      personaType: 'Enterprise Technology Leader'
    },
    {
      id: '2',
      name: 'InnovateTech Inc',
      industry: 'Technology',
      country: 'United Kingdom',
      city: 'London',
      size: '450 employees',
      revenue: '$65M',
      description: 'Mid-market technology company focused on digital transformation solutions',
      matchScore: 88,
      relevantDepartments: ['Product Development', 'Engineering', 'Sales'],
      keyProducts: ['Digital Solutions', 'SaaS Platforms', 'Mobile Apps'],
      recentActivity: [
        'Opened London headquarters',
        'Partnership with Microsoft',
        'Launched new product line'
      ],
      personaType: 'Mid-Market Innovation Driver'
    },
    {
      id: '3',
      name: 'HealthTech Innovations',
      industry: 'Healthcare',
      country: 'Canada',
      city: 'Toronto',
      size: '850 employees',
      revenue: '$120M',
      description: 'Digital health solutions company focused on telemedicine and patient engagement',
      matchScore: 92,
      relevantDepartments: ['Technology', 'Product Development', 'Clinical Operations'],
      keyProducts: ['Telemedicine Platform', 'Patient Engagement Tools', 'Health Analytics'],
      recentActivity: [
        'FDA approval for new device',
        'Partnership with major hospital system',
        'IPO filing announced'
      ],
      personaType: 'Healthcare Digital Transformer'
    },
    {
      id: '4',
      name: 'Global Manufacturing Corp',
      industry: 'Manufacturing',
      country: 'Germany',
      city: 'Munich',
      size: '1800 employees',
      revenue: '$420M',
      description: 'International manufacturing company with focus on automotive and aerospace components',
      matchScore: 82,
      relevantDepartments: ['Operations', 'Engineering', 'Quality Control'],
      keyProducts: ['Automotive Parts', 'Aerospace Components', 'Industrial Equipment'],
      recentActivity: [
        'Opened new facility in Mexico',
        'Implementing Industry 4.0 initiatives',
        'Partnership with Tesla announced'
      ],
      personaType: 'Manufacturing Efficiency Expert'
    },
    {
      id: '5',
      name: 'Financial Services Group',
      industry: 'Financial Services',
      country: 'United Kingdom',
      city: 'London',
      size: '3200 employees',
      revenue: '$1.2B',
      description: 'Leading financial services provider offering banking and investment solutions',
      matchScore: 79,
      relevantDepartments: ['Technology', 'Risk Management', 'Customer Experience'],
      keyProducts: ['Banking Solutions', 'Investment Services', 'Risk Management Tools'],
      recentActivity: [
        'Digital transformation initiative launched',
        'New mobile banking app released',
        'Acquired fintech startup'
      ],
      personaType: 'Financial Services Innovator'
    },
    {
      id: '6',
      name: 'Retail Dynamics',
      industry: 'Retail',
      country: 'Australia',
      city: 'Sydney',
      size: '1200 employees',
      revenue: '$350M',
      description: 'Multi-channel retail company with strong e-commerce presence',
      matchScore: 76,
      relevantDepartments: ['E-commerce', 'Marketing', 'Supply Chain'],
      keyProducts: ['Consumer Electronics', 'Home Goods', 'Fashion'],
      recentActivity: [
        'Launched new e-commerce platform',
        'Expanded to Southeast Asia',
        'Sustainability initiative announced'
      ],
      personaType: 'Retail Digital Pioneer'
    },
    {
      id: '7',
      name: 'Energy Solutions Ltd',
      industry: 'Energy',
      country: 'Norway',
      city: 'Oslo',
      size: '2800 employees',
      revenue: '$2.1B',
      description: 'Renewable energy company specializing in offshore wind and solar solutions',
      matchScore: 73,
      relevantDepartments: ['Engineering', 'Project Management', 'Operations'],
      keyProducts: ['Wind Turbines', 'Solar Panels', 'Energy Storage'],
      recentActivity: [
        'Completed largest offshore wind project',
        'Expanded to US market',
        'Green bond issuance'
      ],
      personaType: 'Energy Sector Modernizer'
    },
    {
      id: '8',
      name: 'EduTech University',
      industry: 'Education',
      country: 'United States',
      city: 'Boston',
      size: '1500 employees',
      revenue: '$85M',
      description: 'Leading educational institution with focus on online learning and technology integration',
      matchScore: 70,
      relevantDepartments: ['IT Services', 'Academic Technology', 'Student Services'],
      keyProducts: ['Online Learning Platform', 'Student Management System', 'Virtual Labs'],
      recentActivity: [
        'Launched new online degree programs',
        'Partnership with tech companies',
        'Campus modernization project'
      ],
      personaType: 'Education Technology Adopter'
    },
    {
      id: '9',
      name: 'City Government Services',
      industry: 'Government',
      country: 'Canada',
      city: 'Ottawa',
      size: '5000 employees',
      revenue: '$500M',
      description: 'Municipal government focused on digital services and citizen engagement',
      matchScore: 67,
      relevantDepartments: ['IT Department', 'Digital Services', 'Public Works'],
      keyProducts: ['Citizen Portal', 'Digital Services', 'Smart City Solutions'],
      recentActivity: [
        'Launched digital citizen services',
        'Smart city initiative approved',
        'New cybersecurity framework'
      ],
      personaType: 'Government Digital Modernizer'
    },
    {
      id: '10',
      name: 'StartupHub Accelerator',
      industry: 'Technology',
      country: 'Singapore',
      city: 'Singapore',
      size: '85 employees',
      revenue: '$12M',
      description: 'Fast-growing startup accelerator and venture capital firm',
      matchScore: 64,
      relevantDepartments: ['Investment', 'Portfolio Management', 'Operations'],
      keyProducts: ['Accelerator Programs', 'Venture Capital', 'Startup Services'],
      recentActivity: [
        'Launched new accelerator program',
        'Raised $100M fund',
        'Expanded to Southeast Asia'
      ],
      personaType: 'Startup Growth Accelerator'
    }
  ];

  // Get unique persona types for filter
  const personaTypes = [...new Set(businesses.map(b => b.personaType))];

  const filteredBusinesses = businesses.filter(business => {
    const matchesCountry = !filterCountry || business.country === filterCountry;
    const matchesIndustry = !filterIndustry || business.industry === filterIndustry;
    const matchesPersona = !filterPersona || business.personaType === filterPersona;
    return matchesCountry && matchesIndustry && matchesPersona;
  });



  const getMatchScoreColor = (score: number) => {
    if (score >= 90) return 'text-green-600 bg-green-100';
    if (score >= 80) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  const handleViewDecisionMakers = (business: Business) => {
    // Navigate to decision maker profiles (next step in flow)
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'decision-maker-profiles' }));
  };

  // Show discovery progress UI for real users
  if (isLoading || (discoveryStatus === 'discovering' && businesses.length === 0)) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h3 className="text-lg font-semibold text-gray-900">Discovering businesses...</h3>
          <p className="text-gray-600 mb-4">AI agents are searching for businesses using Serper Places API</p>
          
          {/* Progress indicators */}
          <div className="space-y-2 text-sm text-gray-500">
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>Business personas generated</span>
            </div>
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              <span>Searching for businesses in your target market...</span>
            </div>
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-gray-300 rounded-full"></div>
              <span>Analyzing business profiles with AI</span>
            </div>
          </div>
          
          <div className="mt-6 text-xs text-gray-400">
            Results will appear as soon as businesses are found
          </div>
        </div>
      </div>
    );
  }

  // Show "still processing" state for users with search but no businesses yet
  const currentSearch = getCurrentSearch();
  if (hasSearch && businesses.length === 0 && !isLoading && discoveryStatus !== 'discovering' && !isDemoUser(authState.user?.id, authState.user?.email)) {
    // Check if this is a recent search that might still be processing
    if (currentSearch) {
      const searchAge = Date.now() - new Date(currentSearch.created_at).getTime();
      const isRecentSearch = searchAge < 10 * 60 * 1000; // 10 minutes
      
      if (isRecentSearch) {
        // Show processing message for recent searches with no results yet
        return (
          <div className="flex items-center justify-center min-h-96">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold text-gray-900">Still searching for businesses...</h3>
              <p className="text-gray-600 mt-2">
                Our AI agents are working to find the best matching businesses. This may take a few minutes.
              </p>
            </div>
          </div>
        );
      }
    }
  }

  // Show empty state for real users without any searches
  if (!hasSearch && !isDemoUser(authState.user?.id, authState.user?.email)) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center max-w-md">
          <Building className="w-24 h-24 text-gray-300 mx-auto mb-6" />
          <h3 className="text-2xl font-semibold text-gray-900 mb-4">No Business Results Yet</h3>
          <p className="text-gray-600 mb-8">
            Start a search to discover businesses that match your product or service criteria.
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
            {state.selectedPersonas && state.selectedPersonas.length === 1 
              ? `Businesses: ${state.selectedPersonas[0].title}`
              : `Businesses for "${state.searchData?.productService}"`
            }
          </h1>
          <p className="text-gray-600 mt-2">
            {state.selectedPersonas && state.selectedPersonas.length === 1 
              ? `Detailed view of businesses matching the ${state.selectedPersonas[0].title} persona`
              : `Businesses ${state.searchData?.type === 'customer' ? 'that need' : 'that provide'} your product/service, organized by persona type`
            }
          </p>
        </div>
        <div className="text-sm text-gray-500">
          {filteredBusinesses.length} businesses found
          {state.selectedPersonas && state.selectedPersonas.length === 1 && (
            <div className="text-blue-600 font-medium">
              Filtered by: {state.selectedPersonas[0].title}
            </div>
          )}
        </div>
      </div>

      {/* Enhanced Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center space-x-4">
          <Filter className="w-5 h-5 text-gray-400" />
          <div className="flex space-x-4 flex-1">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Business Persona</label>
              <select
                value={filterPersona}
                onChange={(e) => setFilterPersona(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-48"
              >
                <option value="">All Personas</option>
                {personaTypes.map(persona => (
                  <option key={persona} value={persona}>{persona}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
              <select
                value={filterCountry}
                onChange={(e) => setFilterCountry(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Countries</option>
                <option value="United States">United States</option>
                <option value="Germany">Germany</option>
                <option value="Canada">Canada</option>
                <option value="United Kingdom">United Kingdom</option>
                <option value="Australia">Australia</option>
                <option value="Norway">Norway</option>
                <option value="Singapore">Singapore</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
              <select
                value={filterIndustry}
                onChange={(e) => setFilterIndustry(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Industries</option>
                <option value="Technology">Technology</option>
                <option value="Healthcare">Healthcare</option>
                <option value="Manufacturing">Manufacturing</option>
                <option value="Financial Services">Financial Services</option>
                <option value="Retail">Retail</option>
                <option value="Energy">Energy</option>
                <option value="Education">Education</option>
                <option value="Government">Government</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Business List */}
        <div className="space-y-4">
          {filteredBusinesses.map((business) => (
            <div
              key={business.id}
              onClick={() => setSelectedBusiness(business)}
              className={`bg-white rounded-xl shadow-sm border-2 p-6 cursor-pointer transition-all hover:shadow-md ${
                selectedBusiness?.id === business.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 text-lg">{business.name}</h3>
                  <p className="text-gray-600 mt-1">{business.description}</p>
                  <div className="flex items-center space-x-2 mt-2">
                    <Target className="w-4 h-4 text-blue-600" />
                    <span className="text-sm text-blue-600 font-medium">{business.personaType}</span>
                  </div>
                </div>
                <div className={`px-3 py-1 rounded-full text-sm font-medium ${getMatchScoreColor(business.matchScore)}`}>
                  <Star className="w-4 h-4 inline mr-1" />
                  {business.matchScore}% match
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                <div className="flex items-center space-x-2 text-gray-600">
                  <Building className="w-4 h-4" />
                  <span>{business.industry}</span>
                </div>
                <div className="flex items-center space-x-2 text-gray-600">
                  <Users className="w-4 h-4" />
                  <span>{business.size}</span>
                </div>
                <div className="flex items-center space-x-2 text-gray-600">
                  <MapPin className="w-4 h-4" />
                  <span>{business.city}, {business.country}</span>
                </div>
                <div className="flex items-center space-x-2 text-gray-600">
                  <DollarSign className="w-4 h-4" />
                  <span>{business.revenue}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {business.relevantDepartments.slice(0, 2).map((dept, index) => (
                  <span key={index} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                    {dept}
                  </span>
                ))}
                {business.relevantDepartments.length > 2 && (
                  <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                    +{business.relevantDepartments.length - 2} more
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Business Details */}
        <div className="sticky top-8">
          {selectedBusiness ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">{selectedBusiness.name}</h2>
                  <p className="text-gray-600 mt-1">{selectedBusiness.city}, {selectedBusiness.country}</p>
                  <div className="flex items-center space-x-2 mt-2">
                    <Target className="w-4 h-4 text-blue-600" />
                    <span className="text-sm text-blue-600 font-medium">{selectedBusiness.personaType}</span>
                  </div>
                </div>
                <div className={`px-4 py-2 rounded-full text-sm font-medium ${getMatchScoreColor(selectedBusiness.matchScore)}`}>
                  {selectedBusiness.matchScore}% Match
                </div>
              </div>

              <p className="text-gray-600 mb-6">{selectedBusiness.description}</p>

              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3">Relevant Departments</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedBusiness.relevantDepartments.map((dept, index) => (
                      <span key={index} className="px-3 py-1 bg-blue-100 text-blue-800 text-sm rounded-full">
                        {dept}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-gray-900 mb-3">
                    {state.searchData?.type === 'customer' ? 'Current Products/Services' : 'Products/Services Offered'}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedBusiness.keyProducts.map((product, index) => (
                      <span key={index} className="px-3 py-1 bg-green-100 text-green-800 text-sm rounded-full">
                        {product}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-gray-900 mb-3">Recent Activity</h3>
                  <ul className="space-y-2">
                    {selectedBusiness.recentActivity.map((activity, index) => (
                      <li key={index} className="flex items-start space-x-2">
                        <div className="w-2 h-2 bg-blue-600 rounded-full mt-2 flex-shrink-0"></div>
                        <span className="text-gray-600 text-sm">{activity}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  onClick={() => handleViewDecisionMakers(selectedBusiness)}
                  className="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors mt-6"
                >
                  <span>Next: Decision Maker Profiles</span>
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
              <Building className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Business</h3>
              <p className="text-gray-600">
                Choose a business from the list to view detailed information and proceed to decision makers.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}