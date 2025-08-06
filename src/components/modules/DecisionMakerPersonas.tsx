import React, { useState, useEffect } from 'react';
import { UserCheck, Crown, Shield, User, Users, Target, TrendingUp, DollarSign, Star, ArrowRight, ChevronDown, ChevronUp, Eye, Search, Plus } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { useUserData } from '../../context/UserDataContext';
import { useAuth } from '../../context/AuthContext';
import { SearchService } from '../../services/searchService';
import { useDemoMode } from '../../hooks/useDemoMode';

import { DEMO_USER_ID, DEMO_USER_EMAIL, isDemoUser } from '../../constants/demo';

interface DecisionMakerPersona {
  id: string;
  title: string;
  rank: number;
  matchScore: number;
  demographics: {
    level: string;
    department: string;
    experience: string;
    geography: string;
  };
  characteristics: {
    responsibilities: string[];
    painPoints: string[];
    motivations: string[];
    challenges: string[];
    decisionFactors: string[];
  };
  behaviors: {
    decisionMaking: string;
    communicationStyle: string;
    buyingProcess: string;
    preferredChannels: string[];
  };
  marketPotential: {
    totalDecisionMakers: number;
    avgInfluence: string;
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

export default function DecisionMakerPersonas() {
  const { state, updateSelectedDecisionMakerPersonas } = useAppContext();
  const { getCurrentSearch } = useUserData();
  const { state: authState } = useAuth();
  // Simple demo user detection
  const isDemoUser = (userId?: string | null, userEmail?: string | null) => {
    return userId === DEMO_USER_ID || userId === 'demo-user' || userEmail === DEMO_USER_EMAIL;
  };
  const [selectedPersona, setSelectedPersona] = useState<DecisionMakerPersona | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedPersonas, setExpandedPersonas] = useState<string[]>([]);
  const [personas, setPersonas] = useState<DecisionMakerPersona[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasSearch, setHasSearch] = useState(false);

  // Load personas on component mount
  useEffect(() => {
    loadPersonas();
  }, [getCurrentSearch, authState.user]);

  const loadPersonas = async () => {
    setIsLoading(true);
    try {
      const currentSearch = getCurrentSearch();
      const isDemo = isDemoUser(authState.user?.id, authState.user?.email);
      
      // For demo users, use static data
      if (isDemo) {
        setPersonas(getStaticPersonas());
        setHasSearch(true);
      } else if (!currentSearch) {
        // Real user with no search - show empty state
        setPersonas([]);
        setHasSearch(false);
      } else {
        // Real user with search - load from database
        let dbPersonas = await SearchService.getDecisionMakerPersonas(currentSearch.id);
        
        if (dbPersonas.length === 0) {
          // For existing searches, just show no data available
          // Don't generate new personas when viewing historical searches
          console.log(`No decision maker personas found for search ${currentSearch.id}`);
        }
        
        // Convert database format to component format
        const formattedPersonas = dbPersonas.map((persona) => ({
          id: persona.id,
          title: persona.title,
          rank: persona.rank,
          matchScore: persona.match_score,
          demographics: {
            level: persona.demographics?.level || 'Senior Executive',
            department: persona.demographics?.department || 'Technology',
            experience: persona.demographics?.experience || '10+ years',
            geography: persona.demographics?.geography || 'Global'
          },
          characteristics: {
            responsibilities: persona.characteristics?.responsibilities || [],
            painPoints: persona.characteristics?.painPoints || [],
            motivations: persona.characteristics?.motivations || [],
            challenges: persona.characteristics?.challenges || [],
            decisionFactors: persona.characteristics?.decisionFactors || []
          },
          behaviors: {
            decisionMaking: persona.behaviors?.decisionMaking || 'Data-driven decision making',
            communicationStyle: persona.behaviors?.communicationStyle || 'Direct and analytical',
            buyingProcess: persona.behaviors?.buyingProcess || 'Thorough evaluation process',
            preferredChannels: persona.behaviors?.preferredChannels || []
          },
          marketPotential: {
            totalDecisionMakers: persona.market_potential?.totalDecisionMakers || 1000,
            avgInfluence: persona.market_potential?.avgInfluence || 'High',
            conversionRate: persona.market_potential?.conversionRate || '15%'
          },
          employees: [] // Will be loaded separately
        }));
        
        // Load decision makers for each persona
        const personasWithEmployees = await Promise.all(
          formattedPersonas.map(async (persona) => {
            try {
              // Get decision makers for this persona
              const decisionMakers = await SearchService.getDecisionMakers(currentSearch.id);
              // For now, assign all decision makers to each persona (can be refined later)
              const personaEmployees = decisionMakers.slice(0, 5).map(dm => ({
                id: dm.id,
                name: dm.name,
                title: dm.title || 'Decision Maker',
                company: dm.company || 'Unknown Company',
                matchScore: dm.match_score || 75
              }));
              
              return {
                ...persona,
                employees: personaEmployees
              };
            } catch (error) {
              console.error(`Error loading decision makers for persona ${persona.id}:`, error);
              return {
                ...persona,
                employees: []
              };
            }
          })
        );

        setPersonas(personasWithEmployees);
        setHasSearch(true);
      }
    } catch (error) {
      console.error('Error loading decision maker personas:', error);
      setPersonas([]);
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
      demographics: {
        level: 'C-Level Executive',
        department: 'Technology',
        experience: '15+ years',
        geography: 'North America, Europe'
      },
      characteristics: {
        responsibilities: ['Technology strategy and vision', 'Digital transformation leadership', 'Technology budget allocation', 'Vendor relationship management'],
        painPoints: ['Legacy system modernization', 'Cybersecurity threats', 'Talent acquisition', 'Technology ROI measurement'],
        motivations: ['Innovation leadership', 'Competitive advantage', 'Operational efficiency', 'Business growth enablement'],
        challenges: ['Budget constraints', 'Rapid technology changes', 'Integration complexity', 'Change management'],
        decisionFactors: ['Strategic alignment', 'Scalability', 'Security', 'Vendor stability']
      },
      behaviors: {
        decisionMaking: 'Strategic, data-driven with long-term vision',
        communicationStyle: 'High-level strategic discussions with technical depth when needed',
        buyingProcess: 'Committee-based with 6-12 month evaluation cycles',
        preferredChannels: ['Executive briefings', 'Industry conferences', 'Peer networks', 'Analyst reports']
      },
      marketPotential: {
        totalDecisionMakers: 2500,
        avgInfluence: '95%',
        conversionRate: '8%'
      },
      employees: [
        { id: '1', name: 'Sarah Johnson', title: 'Chief Technology Officer', company: 'TechCorp Solutions', matchScore: 95 },
        { id: '2', name: 'Michael Chen', title: 'CTO', company: 'InnovateTech Inc', matchScore: 92 },
        { id: '3', name: 'David Rodriguez', title: 'Chief Technology Officer', company: 'HealthTech Innovations', matchScore: 90 },
        { id: '4', name: 'Lisa Wang', title: 'CTO', company: 'Global Manufacturing Corp', matchScore: 88 },
        { id: '5', name: 'James Thompson', title: 'Chief Technology Officer', company: 'Financial Services Group', matchScore: 85 }
      ]
    },
    {
      id: '2',
      title: 'VP of Engineering',
      rank: 2,
      matchScore: 88,
      demographics: {
        level: 'VP Level',
        department: 'Engineering',
        experience: '12+ years',
        geography: 'Global'
      },
      characteristics: {
        responsibilities: ['Engineering team leadership', 'Technical architecture decisions', 'Product development oversight', 'Engineering process optimization'],
        painPoints: ['Technical debt management', 'Team scalability', 'Development velocity', 'Quality assurance'],
        motivations: ['Technical excellence', 'Team productivity', 'Innovation delivery', 'System reliability'],
        challenges: ['Resource allocation', 'Technology choices', 'Timeline pressures', 'Skill development'],
        decisionFactors: ['Technical merit', 'Development efficiency', 'Team adoption', 'Maintenance overhead']
      },
      behaviors: {
        decisionMaking: 'Technical evaluation with team input',
        communicationStyle: 'Technical depth with practical focus',
        buyingProcess: 'Technical evaluation with 3-6 month cycles',
        preferredChannels: ['Technical demos', 'Developer conferences', 'Peer recommendations', 'Technical documentation']
      },
      marketPotential: {
        totalDecisionMakers: 4200,
        avgInfluence: '80%',
        conversionRate: '15%'
      },
      employees: [
        { id: '6', name: 'Alex Kumar', title: 'VP of Engineering', company: 'TechCorp Solutions', matchScore: 88 },
        { id: '7', name: 'Maria Garcia', title: 'VP Engineering', company: 'InnovateTech Inc', matchScore: 85 },
        { id: '8', name: 'Robert Kim', title: 'VP of Engineering', company: 'HealthTech Innovations', matchScore: 82 },
        { id: '9', name: 'Jennifer Liu', title: 'VP Engineering', company: 'Retail Dynamics', matchScore: 80 },
        { id: '10', name: 'Thomas Anderson', title: 'VP of Engineering', company: 'Energy Solutions Ltd', matchScore: 78 }
      ]
    },
    {
      id: '3',
      title: 'Director of IT',
      rank: 3,
      matchScore: 85,
      demographics: {
        level: 'Director Level',
        department: 'Information Technology',
        experience: '10+ years',
        geography: 'North America, Europe, APAC'
      },
      characteristics: {
        responsibilities: ['IT infrastructure management', 'Technology implementation', 'IT budget management', 'Vendor evaluation'],
        painPoints: ['System integration', 'Security compliance', 'Cost optimization', 'User support'],
        motivations: ['Operational efficiency', 'System reliability', 'Cost control', 'User satisfaction'],
        challenges: ['Legacy system maintenance', 'Security threats', 'Budget limitations', 'Change management'],
        decisionFactors: ['Cost-effectiveness', 'Integration capabilities', 'Support quality', 'Implementation timeline']
      },
      behaviors: {
        decisionMaking: 'Practical evaluation with cost consideration',
        communicationStyle: 'Operational focus with technical understanding',
        buyingProcess: 'Structured evaluation with 4-8 month cycles',
        preferredChannels: ['Industry publications', 'Vendor presentations', 'User groups', 'Online research']
      },
      marketPotential: {
        totalDecisionMakers: 6800,
        avgInfluence: '75%',
        conversionRate: '18%'
      },
      employees: [
        { id: '11', name: 'Kevin Brown', title: 'Director of IT', company: 'Global Manufacturing Corp', matchScore: 85 },
        { id: '12', name: 'Amanda Wilson', title: 'IT Director', company: 'Financial Services Group', matchScore: 82 },
        { id: '13', name: 'Carlos Martinez', title: 'Director of IT', company: 'Retail Dynamics', matchScore: 80 },
        { id: '14', name: 'Rachel Green', title: 'IT Director', company: 'EduTech University', matchScore: 78 },
        { id: '15', name: 'Daniel Lee', title: 'Director of IT', company: 'City Government Services', matchScore: 75 }
      ]
    },
    {
      id: '4',
      title: 'Chief Information Officer',
      rank: 4,
      matchScore: 82,
      demographics: {
        level: 'C-Level Executive',
        department: 'Information Technology',
        experience: '15+ years',
        geography: 'North America, Europe'
      },
      characteristics: {
        responsibilities: ['IT strategy alignment', 'Digital transformation', 'Information governance', 'Technology investment'],
        painPoints: ['Digital transformation complexity', 'Data governance', 'Cybersecurity risks', 'IT-business alignment'],
        motivations: ['Business enablement', 'Innovation leadership', 'Risk mitigation', 'Operational excellence'],
        challenges: ['Legacy modernization', 'Skill gaps', 'Budget justification', 'Regulatory compliance'],
        decisionFactors: ['Business impact', 'Risk assessment', 'Strategic fit', 'Total cost of ownership']
      },
      behaviors: {
        decisionMaking: 'Strategic with risk assessment focus',
        communicationStyle: 'Business-focused with technical awareness',
        buyingProcess: 'Executive committee with 8-12 month cycles',
        preferredChannels: ['Executive briefings', 'Industry forums', 'Analyst research', 'Peer networks']
      },
      marketPotential: {
        totalDecisionMakers: 1800,
        avgInfluence: '90%',
        conversionRate: '10%'
      },
      employees: [
        { id: '16', name: 'Patricia Davis', title: 'Chief Information Officer', company: 'Financial Services Group', matchScore: 82 },
        { id: '17', name: 'Mark Johnson', title: 'CIO', company: 'Global Manufacturing Corp', matchScore: 79 },
        { id: '18', name: 'Susan Miller', title: 'Chief Information Officer', company: 'HealthTech Innovations', matchScore: 77 },
        { id: '19', name: 'Brian Wilson', title: 'CIO', company: 'Energy Solutions Ltd', matchScore: 75 },
        { id: '20', name: 'Linda Taylor', title: 'Chief Information Officer', company: 'EduTech University', matchScore: 73 }
      ]
    },
    {
      id: '5',
      title: 'Head of Digital Transformation',
      rank: 5,
      matchScore: 79,
      demographics: {
        level: 'VP/Director Level',
        department: 'Digital/Strategy',
        experience: '8+ years',
        geography: 'Global'
      },
      characteristics: {
        responsibilities: ['Digital strategy development', 'Change management', 'Process optimization', 'Technology adoption'],
        painPoints: ['Change resistance', 'Process complexity', 'Technology integration', 'ROI measurement'],
        motivations: ['Business transformation', 'Process efficiency', 'Innovation adoption', 'Competitive advantage'],
        challenges: ['Organizational change', 'Technology selection', 'Budget allocation', 'Timeline management'],
        decisionFactors: ['Transformation impact', 'Change management support', 'Integration ease', 'Success metrics']
      },
      behaviors: {
        decisionMaking: 'Collaborative with stakeholder input',
        communicationStyle: 'Change-focused with business impact emphasis',
        buyingProcess: 'Cross-functional evaluation with 6-9 month cycles',
        preferredChannels: ['Transformation conferences', 'Case studies', 'Consultant recommendations', 'Pilot programs']
      },
      marketPotential: {
        totalDecisionMakers: 3200,
        avgInfluence: '70%',
        conversionRate: '12%'
      },
      employees: [
        { id: '21', name: 'Michelle Rodriguez', title: 'Head of Digital Transformation', company: 'Retail Dynamics', matchScore: 79 },
        { id: '22', name: 'Andrew Kim', title: 'Director of Digital Transformation', company: 'Financial Services Group', matchScore: 76 },
        { id: '23', name: 'Sarah Thompson', title: 'Head of Digital Strategy', company: 'Global Manufacturing Corp', matchScore: 74 },
        { id: '24', name: 'John Martinez', title: 'Digital Transformation Lead', company: 'HealthTech Innovations', matchScore: 72 },
        { id: '25', name: 'Emily Chen', title: 'Head of Digital Innovation', company: 'Energy Solutions Ltd', matchScore: 70 }
      ]
    },
    {
      id: '6',
      title: 'VP of Operations',
      rank: 6,
      matchScore: 76,
      demographics: {
        level: 'VP Level',
        department: 'Operations',
        experience: '12+ years',
        geography: 'Global'
      },
      characteristics: {
        responsibilities: ['Operational efficiency', 'Process improvement', 'Resource optimization', 'Performance management'],
        painPoints: ['Process inefficiencies', 'Cost pressures', 'Quality control', 'Scalability challenges'],
        motivations: ['Operational excellence', 'Cost reduction', 'Quality improvement', 'Productivity gains'],
        challenges: ['Process standardization', 'Technology adoption', 'Change management', 'Performance measurement'],
        decisionFactors: ['Operational impact', 'Cost savings', 'Implementation ease', 'Performance metrics']
      },
      behaviors: {
        decisionMaking: 'Data-driven with operational focus',
        communicationStyle: 'Results-oriented with efficiency emphasis',
        buyingProcess: 'Operational evaluation with 4-6 month cycles',
        preferredChannels: ['Operations conferences', 'Best practice sharing', 'Vendor demos', 'ROI case studies']
      },
      marketPotential: {
        totalDecisionMakers: 5500,
        avgInfluence: '65%',
        conversionRate: '20%'
      },
      employees: [
        { id: '26', name: 'Robert Garcia', title: 'VP of Operations', company: 'Global Manufacturing Corp', matchScore: 76 },
        { id: '27', name: 'Lisa Anderson', title: 'VP Operations', company: 'Retail Dynamics', matchScore: 73 },
        { id: '28', name: 'Michael Brown', title: 'VP of Operations', company: 'Energy Solutions Ltd', matchScore: 71 },
        { id: '29', name: 'Jennifer Davis', title: 'VP Operations', company: 'HealthTech Innovations', matchScore: 69 },
        { id: '30', name: 'David Wilson', title: 'VP of Operations', company: 'Financial Services Group', matchScore: 67 }
      ]
    },
    {
      id: '7',
      title: 'Chief Data Officer',
      rank: 7,
      matchScore: 73,
      demographics: {
        level: 'C-Level Executive',
        department: 'Data/Analytics',
        experience: '12+ years',
        geography: 'North America, Europe'
      },
      characteristics: {
        responsibilities: ['Data strategy', 'Analytics governance', 'Data quality', 'Insights generation'],
        painPoints: ['Data silos', 'Data quality issues', 'Analytics adoption', 'Privacy compliance'],
        motivations: ['Data-driven decisions', 'Business insights', 'Competitive intelligence', 'Operational optimization'],
        challenges: ['Data integration', 'Skill development', 'Technology selection', 'Governance implementation'],
        decisionFactors: ['Data capabilities', 'Analytics power', 'Integration ease', 'Compliance features']
      },
      behaviors: {
        decisionMaking: 'Analytics-driven with data focus',
        communicationStyle: 'Data-centric with business context',
        buyingProcess: 'Technical evaluation with 6-8 month cycles',
        preferredChannels: ['Data conferences', 'Analytics forums', 'Technical demos', 'Proof of concepts']
      },
      marketPotential: {
        totalDecisionMakers: 1200,
        avgInfluence: '85%',
        conversionRate: '14%'
      },
      employees: [
        { id: '31', name: 'Dr. Amanda Lee', title: 'Chief Data Officer', company: 'Financial Services Group', matchScore: 73 },
        { id: '32', name: 'Thomas Kim', title: 'CDO', company: 'Retail Dynamics', matchScore: 70 },
        { id: '33', name: 'Maria Rodriguez', title: 'Chief Data Officer', company: 'HealthTech Innovations', matchScore: 68 },
        { id: '34', name: 'James Wilson', title: 'CDO', company: 'TechCorp Solutions', matchScore: 66 },
        { id: '35', name: 'Sarah Martinez', title: 'Chief Data Officer', company: 'Global Manufacturing Corp', matchScore: 64 }
      ]
    },
    {
      id: '8',
      title: 'Director of Product Management',
      rank: 8,
      matchScore: 70,
      demographics: {
        level: 'Director Level',
        department: 'Product',
        experience: '8+ years',
        geography: 'Global'
      },
      characteristics: {
        responsibilities: ['Product strategy', 'Feature prioritization', 'Market research', 'User experience'],
        painPoints: ['Feature complexity', 'Market competition', 'User adoption', 'Development timelines'],
        motivations: ['Product success', 'User satisfaction', 'Market leadership', 'Innovation delivery'],
        challenges: ['Resource prioritization', 'Technical constraints', 'Market timing', 'User feedback integration'],
        decisionFactors: ['Product fit', 'User impact', 'Development efficiency', 'Market differentiation']
      },
      behaviors: {
        decisionMaking: 'User-centric with market validation',
        communicationStyle: 'Product-focused with user empathy',
        buyingProcess: 'Product evaluation with 3-5 month cycles',
        preferredChannels: ['Product conferences', 'User research', 'Beta programs', 'Product demos']
      },
      marketPotential: {
        totalDecisionMakers: 4800,
        avgInfluence: '60%',
        conversionRate: '25%'
      },
      employees: [
        { id: '36', name: 'Jessica Chen', title: 'Director of Product Management', company: 'TechCorp Solutions', matchScore: 70 },
        { id: '37', name: 'Ryan Thompson', title: 'Product Director', company: 'InnovateTech Inc', matchScore: 67 },
        { id: '38', name: 'Nicole Garcia', title: 'Director of Product', company: 'Retail Dynamics', matchScore: 65 },
        { id: '39', name: 'Kevin Lee', title: 'Product Management Director', company: 'HealthTech Innovations', matchScore: 63 },
        { id: '40', name: 'Laura Wilson', title: 'Director of Product Management', company: 'StartupHub Accelerator', matchScore: 61 }
      ]
    },
    {
      id: '9',
      title: 'Head of Procurement',
      rank: 9,
      matchScore: 67,
      demographics: {
        level: 'Director Level',
        department: 'Procurement',
        experience: '10+ years',
        geography: 'Global'
      },
      characteristics: {
        responsibilities: ['Vendor management', 'Contract negotiation', 'Cost optimization', 'Risk assessment'],
        painPoints: ['Vendor evaluation', 'Cost pressures', 'Compliance requirements', 'Supply chain risks'],
        motivations: ['Cost savings', 'Risk mitigation', 'Quality assurance', 'Process efficiency'],
        challenges: ['Vendor selection', 'Contract terms', 'Budget constraints', 'Stakeholder alignment'],
        decisionFactors: ['Total cost of ownership', 'Vendor stability', 'Contract terms', 'Risk profile']
      },
      behaviors: {
        decisionMaking: 'Cost-focused with risk assessment',
        communicationStyle: 'Commercial focus with compliance awareness',
        buyingProcess: 'Formal procurement with 6-12 month cycles',
        preferredChannels: ['Procurement conferences', 'RFP processes', 'Vendor presentations', 'Industry reports']
      },
      marketPotential: {
        totalDecisionMakers: 3800,
        avgInfluence: '55%',
        conversionRate: '16%'
      },
      employees: [
        { id: '41', name: 'Christopher Brown', title: 'Head of Procurement', company: 'Global Manufacturing Corp', matchScore: 67 },
        { id: '42', name: 'Angela Davis', title: 'Procurement Director', company: 'Financial Services Group', matchScore: 64 },
        { id: '43', name: 'Steven Martinez', title: 'Head of Procurement', company: 'Energy Solutions Ltd', matchScore: 62 },
        { id: '44', name: 'Michelle Kim', title: 'Procurement Manager', company: 'Retail Dynamics', matchScore: 60 },
        { id: '45', name: 'Daniel Rodriguez', title: 'Head of Procurement', company: 'HealthTech Innovations', matchScore: 58 }
      ]
    },
    {
      id: '10',
      title: 'VP of Sales',
      rank: 10,
      matchScore: 64,
      demographics: {
        level: 'VP Level',
        department: 'Sales',
        experience: '12+ years',
        geography: 'Global'
      },
      characteristics: {
        responsibilities: ['Sales strategy', 'Revenue growth', 'Team leadership', 'Customer relationships'],
        painPoints: ['Sales efficiency', 'Lead quality', 'Customer acquisition', 'Revenue predictability'],
        motivations: ['Revenue growth', 'Sales performance', 'Customer success', 'Market expansion'],
        challenges: ['Sales process optimization', 'Technology adoption', 'Team productivity', 'Customer retention'],
        decisionFactors: ['Sales impact', 'ROI measurement', 'Adoption ease', 'Performance metrics']
      },
      behaviors: {
        decisionMaking: 'Results-driven with performance focus',
        communicationStyle: 'Revenue-focused with customer emphasis',
        buyingProcess: 'Sales evaluation with 3-6 month cycles',
        preferredChannels: ['Sales conferences', 'Performance demos', 'ROI case studies', 'Peer recommendations']
      },
      marketPotential: {
        totalDecisionMakers: 7200,
        avgInfluence: '50%',
        conversionRate: '30%'
      },
      employees: [
        { id: '46', name: 'Mark Thompson', title: 'VP of Sales', company: 'TechCorp Solutions', matchScore: 64 },
        { id: '47', name: 'Rachel Garcia', title: 'VP Sales', company: 'InnovateTech Inc', matchScore: 61 },
        { id: '48', name: 'Jonathan Lee', title: 'VP of Sales', company: 'Retail Dynamics', matchScore: 59 },
        { id: '49', name: 'Stephanie Wilson', title: 'VP Sales', company: 'HealthTech Innovations', matchScore: 57 },
        { id: '50', name: 'Paul Martinez', title: 'VP of Sales', company: 'StartupHub Accelerator', matchScore: 55 }
      ]
    }
  ];

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

  const handleViewEmployeesForPersona = (persona: DecisionMakerPersona) => {
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
  if (!hasSearch && !isDemoUser(authState.user?.id, authState.user?.email)) {
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
            Top 10 Decision Maker Personas for "{state.searchData?.productService}"
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
                      <p className="text-gray-600 mt-1">{persona.demographics.level} • {persona.demographics.department}</p>
                      <p className="text-sm text-gray-500">{persona.demographics.experience} • {persona.demographics.geography}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`px-3 py-1 rounded-full text-sm font-medium mb-2 ${getMatchScoreColor(persona.matchScore)}`}>
                      <Star className="w-4 h-4 inline mr-1" />
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
                    <span>{persona.marketPotential.avgInfluence} avg influence</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-600">
                    <DollarSign className="w-4 h-4" />
                    <span>{persona.marketPotential.conversionRate} conversion</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-600">
                    {getLevelIcon(persona.demographics.level)}
                    <span>{persona.demographics.level}</span>
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
                    <ChevronUp className="w-4 h-4 text-gray-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-500" />
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
                            <span className="font-semibold text-blue-900">{selectedPersona.marketPotential.avgInfluence}</span>
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
                            <span className="font-semibold text-green-900">{selectedPersona.demographics.level}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-green-700">Department:</span>
                            <span className="font-semibold text-green-900">{selectedPersona.demographics.department}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-green-700">Experience:</span>
                            <span className="font-semibold text-green-900">{selectedPersona.demographics.experience}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-3">Key Responsibilities</h4>
                        <div className="space-y-2">
                          {selectedPersona.characteristics.responsibilities.map((responsibility, index) => (
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

                      <div className="bg-yellow-50 rounded-xl p-4 border border-yellow-200">
                        <h4 className="font-semibold text-yellow-900 mb-3">Challenges</h4>
                        <div className="space-y-2">
                          {selectedPersona.characteristics.challenges.map((challenge, index) => (
                            <div key={index} className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                              <span className="text-yellow-800 text-sm">{challenge}</span>
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
                    </div>
                  </div>
                )}

                {activeTab === 'behaviors' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div className="bg-white border border-gray-200 rounded-xl p-4">
                          <h4 className="font-semibold text-gray-900 mb-2">Decision Making</h4>
                          <p className="text-gray-700 text-sm">{selectedPersona.behaviors.decisionMaking}</p>
                        </div>

                        <div className="bg-white border border-gray-200 rounded-xl p-4">
                          <h4 className="font-semibold text-gray-900 mb-2">Communication Style</h4>
                          <p className="text-gray-700 text-sm">{selectedPersona.behaviors.communicationStyle}</p>
                        </div>

                        <div className="bg-white border border-gray-200 rounded-xl p-4">
                          <h4 className="font-semibold text-gray-900 mb-2">Buying Process</h4>
                          <p className="text-gray-700 text-sm">{selectedPersona.behaviors.buyingProcess}</p>
                        </div>
                      </div>

                      <div>
                        <div className="bg-white border border-gray-200 rounded-xl p-4">
                          <h4 className="font-semibold text-gray-900 mb-3">Preferred Channels</h4>
                          <div className="space-y-2">
                            {selectedPersona.behaviors.preferredChannels.map((channel, index) => (
                              <div key={index} className="flex items-center space-x-2">
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