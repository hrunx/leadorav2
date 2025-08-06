import React, { useState, useEffect } from 'react';
import { User, Crown, Shield, Users, Mail, Phone, Linkedin, ArrowRight, Building, Eye, X, Target, TrendingUp, Search, Plus } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { useUserData } from '../../context/UserDataContext';
import { useAuth } from '../../context/AuthContext';
import { SearchService } from '../../services/searchService';
import { useDemoMode } from '../../hooks/useDemoMode';
import { useRealTimeSearch } from '../../hooks/useRealTimeSearch';
import { supabase } from '../../lib/supabase';

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
  
  // Legacy demo state
  const [demoPersonas, setDemoPersonas] = useState<DecisionMakerPersona[]>([]);
  const [isLoadingDemo, setIsLoadingDemo] = useState(true);
  
  // Determine if we're in demo mode
  const isDemo = isDemoUser(authState.user?.id, authState.user?.email);
  
  // Use real-time data for real users, demo data for demo users
  const decisionMakerPersonas = isDemo ? demoPersonas : realTimeData.dmPersonas.map(p => ({
    id: p.id,
    title: p.title,
    rank: p.rank,
    description: p.description || `Key ${p.title} decision maker profile`,
    responsibilities: p.responsibilities || [],
    painPoints: p.pain_points || [],
    preferredChannels: p.preferred_channels || [],
    keyMessages: p.key_messages || [],
    avgEmployees: p.avg_employees || 0,
    employeeProfiles: []
  }));
  
  const isLoading = isDemo ? isLoadingDemo : realTimeData.isLoading || (realTimeData.progress.phase !== 'completed' && decisionMakerPersonas.length === 0);
  const hasSearch = isDemo ? demoPersonas.length > 0 : !!currentSearch;
  
  // Discovery status based on real-time progress
  const discoveryStatus = isDemo ? 'completed' : 
    realTimeData.progress.phase === 'completed' ? 'completed' :
    realTimeData.progress.decision_makers_count > 0 ? 'discovering' : 'discovering';

  // Load demo data for demo users only
  useEffect(() => {
    if (isDemo) {
      setDemoPersonas(getStaticDMPersonas());
      setIsLoadingDemo(false);
    }
  }, [isDemo]);

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

  // Function to check orchestration progress for decision makers
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
        
        console.log(`DM Discovery progress: ${progress?.phase}, Decision makers found: ${dataCounts?.decision_makers || 0}`);
        
        // Update discovery status based on progress and data
        if (dataCounts?.decision_makers > 0) {
          setDiscoveryStatus('completed');
          setIsLoading(false);
          // Reload data if we have new decision makers
          loadData();
        } else if (progress?.phase === 'completed') {
          setDiscoveryStatus('completed');
          setIsLoading(false);
        } else if (progress?.phase === 'decision_makers') {
          setDiscoveryStatus('discovering');
          // Keep checking progress
          setTimeout(() => checkDiscoveryProgress(searchId), 2000);
        } else if (progress?.phase === 'businesses' || progress?.phase === 'starting_discovery' || progress?.phase === 'personas') {
          setDiscoveryStatus('discovering');
          // DM discovery comes after businesses, so keep checking
          setTimeout(() => checkDiscoveryProgress(searchId), 3000);
        } else {
          // Keep checking for a reasonable time
          setTimeout(() => checkDiscoveryProgress(searchId), 5000);
        }
      }
    } catch (error) {
      console.error('Error checking DM discovery progress:', error);
      // Fallback - stop checking after a while
      setTimeout(() => setDiscoveryStatus('completed'), 15000);
    }
  };

  // Real-time subscription for streaming newly inserted decision makers
  useEffect(() => {
    const currentSearch = getCurrentSearch();
    if (!currentSearch) return;
    
    const channel = supabase
      .channel('decision-makers-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'decision_makers',
          filter: `search_id=eq.${currentSearch.id}`
        },
        (payload) => {
          console.log('New decision maker found:', payload.new);
          
          // Update discovery status when first decision maker appears
          setDiscoveryStatus('completed');
          setIsLoading(false);
          
          // Reload data to get the complete persona structure
          loadData();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [getCurrentSearch]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const currentSearch = getCurrentSearch();
      const isDemo = isDemoUser(authState.user?.id, authState.user?.email);
      
      if (isDemo) {
        setDecisionMakerPersonas(getStaticPersonas());
        setHasSearch(true);
      } else if (!currentSearch) {
        setDecisionMakerPersonas([]);
        setHasSearch(false);
      } else {
        // Load real data from database
        try {
          const [dmPersonas, decisionMakers] = await Promise.all([
            SearchService.getDecisionMakerPersonas(currentSearch.id),
            SearchService.getDecisionMakers(currentSearch.id)
          ]);

          if (dmPersonas.length === 0) {
            // Check if search is recent (less than 10 minutes old) - might still be processing
            const searchAge = Date.now() - new Date(currentSearch.created_at).getTime();
            const isRecentSearch = searchAge < 10 * 60 * 1000; // 10 minutes
            
            if (isRecentSearch) {
              console.log(`Search ${currentSearch.id} is recent and still processing decision makers...`);
              setDiscoveryStatus('discovering');
              // Keep loading state for recent searches
              setIsLoading(true);
              // Check again in a few seconds
              setTimeout(() => loadData(), 4000);
              return;
            } else {
              console.log(`No decision maker personas found for completed search ${currentSearch.id}`);
              setDecisionMakerPersonas([]);
              setHasSearch(true);
              return;
            }
          }

          // Convert database personas to component format with actual employees
          const formattedPersonas = dmPersonas.map((persona) => {
            // Find decision makers for this persona (basic matching by title similarity)
            const personaEmployees = decisionMakers
              .filter(dm => {
                // Simple matching - can be improved with better persona mapping
                const personaTitle = persona.title.toLowerCase();
                const dmTitle = dm.title.toLowerCase();
                return dmTitle.includes(personaTitle.split(' ')[0]) || 
                       dmTitle.includes(personaTitle.split(' ')[1]) ||
                       dm.department.toLowerCase().includes(persona.demographics?.department?.toLowerCase() || '');
              })
              .slice(0, 5) // Max 5 per persona
              .map(dm => ({
                id: dm.id,
                name: dm.name,
                title: dm.title,
                company: dm.company,
                matchScore: dm.match_score || 75
              }));

            return {
              id: persona.id,
              title: persona.title,
              rank: persona.rank,
              matchScore: persona.match_score,
              level: persona.demographics?.level || 'executive',
              department: persona.demographics?.department || 'Technology',
              influence: 85, // Default influence
              demographics: {
                experience: persona.demographics?.experience || '10+ years',
                typicalTitles: persona.characteristics?.responsibilities || [],
                departments: [persona.demographics?.department || 'Technology'],
                companyTypes: ['Technology', 'Enterprise']
              },
              characteristics: {
                keyResponsibilities: persona.characteristics?.responsibilities || [],
                painPoints: persona.characteristics?.painPoints || [],
                motivations: persona.characteristics?.motivations || [],
                decisionFactors: persona.characteristics?.decisionFactors || []
              },
              behaviors: {
                communicationStyle: persona.behaviors?.communicationStyle || 'Direct and analytical',
                decisionTimeline: persona.behaviors?.decisionTimeline || '3-6 months',
                preferredApproach: persona.behaviors?.buyingProcess || 'Thorough evaluation',
                buyingInfluence: 'High'
              },
              marketPotential: {
                totalDecisionMakers: persona.market_potential?.totalDecisionMakers || 1000,
                avgInfluence: persona.market_potential?.avgInfluence || 85,
                conversionRate: persona.market_potential?.conversionRate || '15%'
              },
              employees: personaEmployees
            };
          });

          setDecisionMakerPersonas(formattedPersonas);
          setHasSearch(true);
        } catch (dbError) {
          console.error('Error loading data from database:', dbError);
          setDecisionMakerPersonas([]);
          setHasSearch(true);
        }
      }
    } catch (error) {
      console.error('Error loading decision maker profiles:', error);
      setDecisionMakerPersonas([]);
      setHasSearch(false);
    } finally {
      setIsLoading(false);
    }
  };

  const getStaticPersonas = (): DecisionMakerPersona[] => [
    {
      id: '1',
      title: 'Chief Technology Officer',
      rank: 1,
      matchScore: 95,
      level: 'executive',
      department: 'Technology',
      influence: 95,
      demographics: {
        experience: '15+ years in enterprise technology leadership',
        typicalTitles: ['CTO', 'Chief Technology Officer', 'VP of Technology', 'Head of Technology'],
        departments: ['Technology', 'IT', 'Engineering', 'Digital Transformation'],
        companyTypes: ['Enterprise', 'Technology Companies', 'Fortune 500']
      },
      characteristics: {
        keyResponsibilities: [
          'Technology strategy and vision',
          'Digital transformation initiatives',
          'Technology budget allocation',
          'Vendor relationship management',
          'Innovation and R&D oversight'
        ],
        painPoints: [
          'Legacy system modernization',
          'Balancing innovation with operational stability',
          'Managing technical debt',
          'Cybersecurity and compliance',
          'Scaling technology infrastructure'
        ],
        motivations: [
          'Drive digital transformation success',
          'Maintain competitive technological advantage',
          'Optimize technology investments',
          'Build high-performing technology teams',
          'Ensure operational excellence'
        ],
        decisionFactors: [
          'Proven ROI and business impact',
          'Strategic alignment with company goals',
          'Vendor stability and long-term support',
          'Integration capabilities',
          'Implementation timeline and complexity'
        ]
      },
      behaviors: {
        communicationStyle: 'Strategic, data-driven, prefers executive summaries with clear business impact',
        decisionTimeline: '6-12 months for major technology decisions',
        preferredApproach: 'Executive briefing with clear business case, ROI projections, and strategic roadmap',
        buyingInfluence: 'Final decision maker for technology investments over $500K'
      },
      marketPotential: {
        totalDecisionMakers: 2500,
        avgInfluence: 95,
        conversionRate: '8%'
      },
      employees: [
        { id: '1', name: 'Sarah Johnson', title: 'Chief Technology Officer', company: 'TechCorp Solutions', matchScore: 95 },
        { id: '2', name: 'David Chen', title: 'CTO', company: 'InnovateTech Inc', matchScore: 92 },
        { id: '3', name: 'Maria Rodriguez', title: 'VP of Technology', company: 'Global Manufacturing Corp', matchScore: 89 },
        { id: '4', name: 'James Wilson', title: 'Head of Technology', company: 'Financial Services Group', matchScore: 87 },
        { id: '5', name: 'Lisa Park', title: 'Chief Technology Officer', company: 'HealthTech Innovations', matchScore: 85 }
      ]
    },
    {
      id: '2',
      title: 'VP of Engineering',
      rank: 2,
      matchScore: 88,
      level: 'director',
      department: 'Engineering',
      influence: 80,
      demographics: {
        experience: '10-15 years in software engineering and team management',
        typicalTitles: ['VP of Engineering', 'Director of Engineering', 'Head of Engineering', 'Engineering Manager'],
        departments: ['Engineering', 'Product Development', 'Technology', 'R&D'],
        companyTypes: ['Technology Companies', 'Software Companies', 'Startups', 'Scale-ups']
      },
      characteristics: {
        keyResponsibilities: [
          'Engineering team leadership and development',
          'Technical architecture decisions',
          'Product development oversight',
          'Engineering process optimization',
          'Technical talent acquisition and retention'
        ],
        painPoints: [
          'Managing technical debt effectively',
          'Balancing feature delivery with quality',
          'Scaling engineering processes',
          'Tool fragmentation and integration',
          'Resource allocation and prioritization'
        ],
        motivations: [
          'Build scalable, maintainable systems',
          'Improve team productivity and satisfaction',
          'Deliver high-quality products',
          'Foster innovation and technical excellence',
          'Optimize development workflows'
        ],
        decisionFactors: [
          'Technical capabilities and performance',
          'Integration ease with existing stack',
          'Developer experience and adoption',
          'Support quality and documentation',
          'Scalability and future-proofing'
        ]
      },
      behaviors: {
        communicationStyle: 'Technical, detail-oriented, prefers hands-on demonstrations and proof-of-concepts',
        decisionTimeline: '3-6 months for engineering tool decisions',
        preferredApproach: 'Technical deep-dive with hands-on demonstration, pilot program, and developer feedback',
        buyingInfluence: 'Strong influence on technical tool selection, budget approval needed from CTO/CEO'
      },
      marketPotential: {
        totalDecisionMakers: 4200,
        avgInfluence: 80,
        conversionRate: '15%'
      },
      employees: [
        { id: '6', name: 'Michael Chen', title: 'VP of Engineering', company: 'TechCorp Solutions', matchScore: 88 },
        { id: '7', name: 'Jennifer Kim', title: 'Director of Engineering', company: 'InnovateTech Inc', matchScore: 85 },
        { id: '8', name: 'Robert Taylor', title: 'Head of Engineering', company: 'StartupHub Accelerator', matchScore: 82 },
        { id: '9', name: 'Amanda Foster', title: 'VP of Engineering', company: 'Retail Dynamics', matchScore: 80 },
        { id: '10', name: 'Carlos Martinez', title: 'Engineering Manager', company: 'HealthTech Innovations', matchScore: 78 }
      ]
    },
    {
      id: '3',
      title: 'Director of Operations',
      rank: 3,
      matchScore: 85,
      level: 'director',
      department: 'Operations',
      influence: 75,
      demographics: {
        experience: '8-12 years in operations and process optimization',
        typicalTitles: ['Director of Operations', 'VP of Operations', 'Operations Manager', 'COO'],
        departments: ['Operations', 'Business Operations', 'Process Improvement', 'Supply Chain'],
        companyTypes: ['Manufacturing', 'Healthcare', 'Retail', 'Services']
      },
      characteristics: {
        keyResponsibilities: [
          'Operational process design and optimization',
          'Cross-functional project coordination',
          'Performance metrics and KPI management',
          'Compliance and quality assurance',
          'Vendor and supplier management'
        ],
        painPoints: [
          'Manual processes slowing operations',
          'Data silos preventing visibility',
          'Compliance and regulatory challenges',
          'Resource constraints and budget pressure',
          'Change management resistance'
        ],
        motivations: [
          'Streamline operational processes',
          'Improve data visibility and reporting',
          'Ensure compliance and quality standards',
          'Reduce operational costs',
          'Enable scalable growth'
        ],
        decisionFactors: [
          'Process impact and efficiency gains',
          'Cost-benefit analysis and ROI',
          'Implementation complexity and timeline',
          'Training requirements and adoption',
          'Compliance and audit readiness'
        ]
      },
      behaviors: {
        communicationStyle: 'Process-focused, metrics-driven, prefers structured presentations with clear outcomes',
        decisionTimeline: '4-8 months for operational system decisions',
        preferredApproach: 'Process mapping session with efficiency metrics, implementation roadmap, and success stories',
        buyingInfluence: 'Strong influence on operational tools, works with CFO for budget approval'
      },
      marketPotential: {
        totalDecisionMakers: 3800,
        avgInfluence: 75,
        conversionRate: '12%'
      },
      employees: [
        { id: '11', name: 'Lisa Rodriguez', title: 'Director of Operations', company: 'TechCorp Solutions', matchScore: 85 },
        { id: '12', name: 'Thomas Anderson', title: 'VP of Operations', company: 'Global Manufacturing Corp', matchScore: 82 },
        { id: '13', name: 'Rachel Green', title: 'Operations Manager', company: 'Retail Dynamics', matchScore: 79 },
        { id: '14', name: 'Kevin Brown', title: 'COO', company: 'HealthTech Innovations', matchScore: 77 },
        { id: '15', name: 'Sophie Turner', title: 'Director of Operations', company: 'Energy Solutions Ltd', matchScore: 75 }
      ]
    },
    {
      id: '4',
      title: 'IT Director',
      rank: 4,
      matchScore: 82,
      level: 'director',
      department: 'IT',
      influence: 78,
      demographics: {
        experience: '10-15 years in IT management and infrastructure',
        typicalTitles: ['IT Director', 'Director of IT', 'IT Manager', 'Head of IT'],
        departments: ['IT', 'Information Technology', 'Infrastructure', 'Systems'],
        companyTypes: ['All Industries', 'Enterprise', 'Mid-Market']
      },
      characteristics: {
        keyResponsibilities: [
          'IT infrastructure management',
          'Technology vendor relationships',
          'IT budget planning and allocation',
          'Security and compliance oversight',
          'IT team leadership'
        ],
        painPoints: [
          'Legacy system maintenance',
          'Cybersecurity threats',
          'Budget constraints',
          'System integration challenges',
          'User support and training'
        ],
        motivations: [
          'Modernize IT infrastructure',
          'Improve system reliability',
          'Enhance security posture',
          'Reduce operational costs',
          'Support business growth'
        ],
        decisionFactors: [
          'Security and compliance features',
          'Integration capabilities',
          'Total cost of ownership',
          'Vendor support and reliability',
          'Implementation complexity'
        ]
      },
      behaviors: {
        communicationStyle: 'Technical but business-focused, prefers detailed specifications and security assessments',
        decisionTimeline: '3-9 months for infrastructure decisions',
        preferredApproach: 'Technical evaluation with security review, pilot testing, and vendor references',
        buyingInfluence: 'Decision maker for IT tools under $100K, influences larger decisions'
      },
      marketPotential: {
        totalDecisionMakers: 5200,
        avgInfluence: 78,
        conversionRate: '18%'
      },
      employees: [
        { id: '16', name: 'Mark Thompson', title: 'IT Director', company: 'Financial Services Group', matchScore: 82 },
        { id: '17', name: 'Sarah Williams', title: 'Director of IT', company: 'EduTech University', matchScore: 79 },
        { id: '18', name: 'John Davis', title: 'Head of IT', company: 'City Government Services', matchScore: 76 },
        { id: '19', name: 'Emily Johnson', title: 'IT Manager', company: 'Global Manufacturing Corp', matchScore: 74 },
        { id: '20', name: 'Alex Chen', title: 'IT Director', company: 'Retail Dynamics', matchScore: 72 }
      ]
    },
    {
      id: '5',
      title: 'Chief Information Officer',
      rank: 5,
      matchScore: 79,
      level: 'executive',
      department: 'IT',
      influence: 90,
      demographics: {
        experience: '15+ years in information technology and business strategy',
        typicalTitles: ['CIO', 'Chief Information Officer', 'VP of Information Technology'],
        departments: ['IT', 'Information Technology', 'Digital Strategy'],
        companyTypes: ['Large Enterprise', 'Fortune 500', 'Government']
      },
      characteristics: {
        keyResponsibilities: [
          'Information technology strategy',
          'Digital transformation leadership',
          'IT governance and compliance',
          'Technology investment decisions',
          'Data and analytics strategy'
        ],
        painPoints: [
          'Aligning IT with business strategy',
          'Managing IT complexity',
          'Cybersecurity and risk management',
          'Legacy system modernization',
          'IT talent acquisition'
        ],
        motivations: [
          'Enable business transformation',
          'Optimize IT investments',
          'Ensure data security and compliance',
          'Drive innovation through technology',
          'Build strategic IT capabilities'
        ],
        decisionFactors: [
          'Strategic business alignment',
          'Enterprise scalability',
          'Security and compliance',
          'Vendor partnership potential',
          'Long-term technology roadmap fit'
        ]
      },
      behaviors: {
        communicationStyle: 'Strategic and business-focused, prefers executive briefings with clear business outcomes',
        decisionTimeline: '6-18 months for strategic IT decisions',
        preferredApproach: 'Executive presentation with business case, strategic alignment, and transformation roadmap',
        buyingInfluence: 'Final decision maker for enterprise IT investments'
      },
      marketPotential: {
        totalDecisionMakers: 1800,
        avgInfluence: 90,
        conversionRate: '6%'
      },
      employees: [
        { id: '21', name: 'Patricia Davis', title: 'CIO', company: 'Financial Services Group', matchScore: 79 },
        { id: '22', name: 'Richard Miller', title: 'Chief Information Officer', company: 'Global Manufacturing Corp', matchScore: 76 },
        { id: '23', name: 'Jennifer Wilson', title: 'VP of Information Technology', company: 'HealthTech Innovations', matchScore: 73 },
        { id: '24', name: 'Michael Brown', title: 'CIO', company: 'Energy Solutions Ltd', matchScore: 71 },
        { id: '25', name: 'Laura Garcia', title: 'Chief Information Officer', company: 'EduTech University', matchScore: 69 }
      ]
    },
    {
      id: '6',
      title: 'Product Manager',
      rank: 6,
      matchScore: 76,
      level: 'manager',
      department: 'Product',
      influence: 70,
      demographics: {
        experience: '5-10 years in product management and development',
        typicalTitles: ['Product Manager', 'Senior Product Manager', 'Director of Product', 'VP of Product'],
        departments: ['Product', 'Product Management', 'Product Development'],
        companyTypes: ['Technology Companies', 'SaaS Companies', 'Startups']
      },
      characteristics: {
        keyResponsibilities: [
          'Product strategy and roadmap',
          'Feature prioritization and planning',
          'Cross-functional team coordination',
          'Market research and analysis',
          'User experience optimization'
        ],
        painPoints: [
          'Balancing competing priorities',
          'Resource constraints',
          'Market competition',
          'User feedback integration',
          'Technical debt management'
        ],
        motivations: [
          'Build successful products',
          'Improve user experience',
          'Drive product growth',
          'Stay ahead of competition',
          'Optimize product metrics'
        ],
        decisionFactors: [
          'User impact and experience',
          'Product-market fit',
          'Implementation feasibility',
          'Competitive advantage',
          'ROI and business metrics'
        ]
      },
      behaviors: {
        communicationStyle: 'User-focused, data-driven, prefers product demos and user research insights',
        decisionTimeline: '2-6 months for product tool decisions',
        preferredApproach: 'Product demonstration with user research data, competitive analysis, and success metrics',
        buyingInfluence: 'Strong influence on product tools, budget approval from VP/Director level'
      },
      marketPotential: {
        totalDecisionMakers: 6500,
        avgInfluence: 70,
        conversionRate: '22%'
      },
      employees: [
        { id: '26', name: 'Jessica Taylor', title: 'Product Manager', company: 'InnovateTech Inc', matchScore: 76 },
        { id: '27', name: 'Daniel Kim', title: 'Senior Product Manager', company: 'StartupHub Accelerator', matchScore: 73 },
        { id: '28', name: 'Michelle Wong', title: 'Director of Product', company: 'Retail Dynamics', matchScore: 70 },
        { id: '29', name: 'Ryan O\'Connor', title: 'VP of Product', company: 'HealthTech Innovations', matchScore: 68 },
        { id: '30', name: 'Samantha Lee', title: 'Product Manager', company: 'TechCorp Solutions', matchScore: 66 }
      ]
    },
    {
      id: '7',
      title: 'Procurement Manager',
      rank: 7,
      matchScore: 73,
      level: 'manager',
      department: 'Procurement',
      influence: 60,
      demographics: {
        experience: '6-12 years in procurement and vendor management',
        typicalTitles: ['Procurement Manager', 'Director of Procurement', 'Purchasing Manager', 'Vendor Manager'],
        departments: ['Procurement', 'Purchasing', 'Supply Chain', 'Operations'],
        companyTypes: ['All Industries', 'Manufacturing', 'Healthcare', 'Government']
      },
      characteristics: {
        keyResponsibilities: [
          'Vendor evaluation and selection',
          'Contract negotiation and management',
          'Cost optimization and budget management',
          'Risk assessment and mitigation',
          'Supplier relationship management'
        ],
        painPoints: [
          'Budget pressures and cost constraints',
          'Complex vendor evaluation processes',
          'Contract complexity and legal requirements',
          'Risk assessment and mitigation',
          'Stakeholder alignment on requirements'
        ],
        motivations: [
          'Optimize total cost of ownership',
          'Build strong vendor relationships',
          'Mitigate procurement risks',
          'Streamline procurement processes',
          'Ensure contract compliance'
        ],
        decisionFactors: [
          'Total cost of ownership analysis',
          'Vendor reliability and track record',
          'Contract terms and flexibility',
          'Support levels and SLAs',
          'Risk mitigation and guarantees'
        ]
      },
      behaviors: {
        communicationStyle: 'Detail-oriented, cost-focused, prefers comprehensive proposals with clear terms',
        decisionTimeline: '3-12 months depending on procurement complexity',
        preferredApproach: 'Detailed proposal with cost breakdown, vendor references, and comprehensive risk mitigation plan',
        buyingInfluence: 'Gatekeeper for vendor selection, influences final decision'
      },
      marketPotential: {
        totalDecisionMakers: 4800,
        avgInfluence: 60,
        conversionRate: '16%'
      },
      employees: [
        { id: '31', name: 'David Kim', title: 'Procurement Manager', company: 'TechCorp Solutions', matchScore: 73 },
        { id: '32', name: 'Maria Santos', title: 'Director of Procurement', company: 'Global Manufacturing Corp', matchScore: 70 },
        { id: '33', name: 'James Wilson', title: 'Purchasing Manager', company: 'HealthTech Innovations', matchScore: 67 },
        { id: '34', name: 'Lisa Chen', title: 'Vendor Manager', company: 'Financial Services Group', matchScore: 65 },
        { id: '35', name: 'Robert Johnson', title: 'Procurement Manager', company: 'Energy Solutions Ltd', matchScore: 63 }
      ]
    },
    {
      id: '8',
      title: 'Chief Financial Officer',
      rank: 8,
      matchScore: 70,
      level: 'executive',
      department: 'Finance',
      influence: 85,
      demographics: {
        experience: '15+ years in finance and business leadership',
        typicalTitles: ['CFO', 'Chief Financial Officer', 'VP of Finance', 'Finance Director'],
        departments: ['Finance', 'Accounting', 'Financial Planning'],
        companyTypes: ['All Industries', 'Public Companies', 'Large Private Companies']
      },
      characteristics: {
        keyResponsibilities: [
          'Financial strategy and planning',
          'Budget allocation and oversight',
          'Investment decision approval',
          'Risk management and compliance',
          'Financial reporting and analysis'
        ],
        painPoints: [
          'Budget constraints and cost pressure',
          'ROI justification requirements',
          'Financial risk management',
          'Regulatory compliance',
          'Cash flow optimization'
        ],
        motivations: [
          'Optimize financial performance',
          'Ensure regulatory compliance',
          'Manage financial risks',
          'Support business growth',
          'Maximize shareholder value'
        ],
        decisionFactors: [
          'Clear ROI and payback period',
          'Total cost of ownership',
          'Financial risk assessment',
          'Budget impact and timing',
          'Compliance requirements'
        ]
      },
      behaviors: {
        communicationStyle: 'Numbers-focused, risk-aware, prefers detailed financial analysis and projections',
        decisionTimeline: '6-12 months for significant financial commitments',
        preferredApproach: 'Financial business case with ROI analysis, risk assessment, and budget impact',
        buyingInfluence: 'Final approval for major expenditures, budget gatekeeper'
      },
      marketPotential: {
        totalDecisionMakers: 2200,
        avgInfluence: 85,
        conversionRate: '8%'
      },
      employees: [
        { id: '36', name: 'William Davis', title: 'CFO', company: 'Financial Services Group', matchScore: 70 },
        { id: '37', name: 'Catherine Miller', title: 'Chief Financial Officer', company: 'Global Manufacturing Corp', matchScore: 67 },
        { id: '38', name: 'Steven Brown', title: 'VP of Finance', company: 'HealthTech Innovations', matchScore: 64 },
        { id: '39', name: 'Nancy Wilson', title: 'Finance Director', company: 'Retail Dynamics', matchScore: 62 },
        { id: '40', name: 'Andrew Garcia', title: 'CFO', company: 'Energy Solutions Ltd', matchScore: 60 }
      ]
    },
    {
      id: '9',
      title: 'Head of Digital Transformation',
      rank: 9,
      matchScore: 67,
      level: 'director',
      department: 'Digital Transformation',
      influence: 82,
      demographics: {
        experience: '10-15 years in digital strategy and transformation',
        typicalTitles: ['Head of Digital Transformation', 'Director of Digital Strategy', 'VP of Digital Innovation'],
        departments: ['Digital Transformation', 'Strategy', 'Innovation', 'Technology'],
        companyTypes: ['Traditional Industries', 'Large Enterprise', 'Government']
      },
      characteristics: {
        keyResponsibilities: [
          'Digital transformation strategy',
          'Change management leadership',
          'Technology adoption oversight',
          'Process digitization initiatives',
          'Cultural transformation'
        ],
        painPoints: [
          'Organizational resistance to change',
          'Legacy system integration',
          'Skills gap and training needs',
          'Measuring transformation ROI',
          'Coordinating cross-functional initiatives'
        ],
        motivations: [
          'Drive successful digital transformation',
          'Modernize business processes',
          'Improve operational efficiency',
          'Enable data-driven decision making',
          'Create competitive advantage'
        ],
        decisionFactors: [
          'Transformation impact potential',
          'Change management support',
          'Integration capabilities',
          'User adoption likelihood',
          'Long-term strategic value'
        ]
      },
      behaviors: {
        communicationStyle: 'Strategic and change-focused, prefers transformation roadmaps and success stories',
        decisionTimeline: '6-18 months for transformation initiatives',
        preferredApproach: 'Transformation strategy session with change management plan and success metrics',
        buyingInfluence: 'Strong influence on digital initiatives, works with C-suite for approval'
      },
      marketPotential: {
        totalDecisionMakers: 1500,
        avgInfluence: 82,
        conversionRate: '10%'
      },
      employees: [
        { id: '41', name: 'Alexandra Thompson', title: 'Head of Digital Transformation', company: 'Global Manufacturing Corp', matchScore: 67 },
        { id: '42', name: 'Marcus Johnson', title: 'Director of Digital Strategy', company: 'Financial Services Group', matchScore: 64 },
        { id: '43', name: 'Elena Rodriguez', title: 'VP of Digital Innovation', company: 'HealthTech Innovations', matchScore: 61 },
        { id: '44', name: 'Peter Kim', title: 'Head of Digital Transformation', company: 'Energy Solutions Ltd', matchScore: 59 },
        { id: '45', name: 'Rachel Adams', title: 'Director of Digital Strategy', company: 'City Government Services', matchScore: 57 }
      ]
    },
    {
      id: '10',
      title: 'Business Development Manager',
      rank: 10,
      matchScore: 64,
      level: 'manager',
      department: 'Business Development',
      influence: 65,
      demographics: {
        experience: '5-10 years in business development and partnerships',
        typicalTitles: ['Business Development Manager', 'BD Manager', 'Director of Business Development', 'VP of Business Development'],
        departments: ['Business Development', 'Sales', 'Partnerships', 'Strategy'],
        companyTypes: ['Technology Companies', 'Startups', 'Scale-ups', 'Services']
      },
      characteristics: {
        keyResponsibilities: [
          'Partnership development and management',
          'New business opportunity identification',
          'Strategic alliance negotiations',
          'Market expansion initiatives',
          'Revenue growth strategies'
        ],
        painPoints: [
          'Finding qualified partners',
          'Long partnership development cycles',
          'Measuring partnership ROI',
          'Competitive market dynamics',
          'Resource allocation for initiatives'
        ],
        motivations: [
          'Drive business growth',
          'Build strategic partnerships',
          'Expand market reach',
          'Create competitive advantages',
          'Generate new revenue streams'
        ],
        decisionFactors: [
          'Partnership potential and fit',
          'Market opportunity size',
          'Implementation complexity',
          'Resource requirements',
          'Competitive positioning'
        ]
      },
      behaviors: {
        communicationStyle: 'Relationship-focused, opportunity-driven, prefers partnership proposals and market analysis',
        decisionTimeline: '3-9 months for partnership decisions',
        preferredApproach: 'Partnership proposal with market opportunity analysis and mutual benefit framework',
        buyingInfluence: 'Influences partnership and tool selection, budget approval from VP/Director level'
      },
      marketPotential: {
        totalDecisionMakers: 3200,
        avgInfluence: 65,
        conversionRate: '20%'
      },
      employees: [
        { id: '46', name: 'Christopher Lee', title: 'Business Development Manager', company: 'StartupHub Accelerator', matchScore: 64 },
        { id: '47', name: 'Stephanie Wong', title: 'BD Manager', company: 'InnovateTech Inc', matchScore: 61 },
        { id: '48', name: 'Jonathan Smith', title: 'Director of Business Development', company: 'Retail Dynamics', matchScore: 58 },
        { id: '49', name: 'Amanda Foster', title: 'VP of Business Development', company: 'HealthTech Innovations', matchScore: 56 },
        { id: '50', name: 'Kevin Martinez', title: 'Business Development Manager', company: 'TechCorp Solutions', matchScore: 54 }
      ]
    }
  ]);

  // Detailed employee data
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
  const currentSearch = getCurrentSearch();
  const isDemo = isDemoUser(authState.user?.id, authState.user?.email);
  
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