import { useState, useEffect, useMemo } from 'react';
import logger from '../../lib/logger';
import { Target, Users, Building, ArrowRight, Star, TrendingUp, DollarSign, ChevronDown, ChevronUp, Eye, Search, Plus } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { useUserData } from '../../context/UserDataContext';
import { useAuth } from '../../context/AuthContext';
// import { SearchService } from '../../services/searchService';
import { useRealTimeSearch } from '../../hooks/useRealTimeSearch';
import { isDemoUser } from '../../constants/demo';

interface PersonaData {
  id: string;
  title: string;
  rank: number;
  matchScore: number;
  demographics: {
    industry: string;
    companySize: string;
    geography: string;
    revenue: string;
  };
  characteristics: {
    painPoints: string[];
    motivations: string[];
    challenges: string[];
    decisionFactors: string[];
  };
  behaviors: {
    buyingProcess: string;
    decisionTimeline: string;
    budgetRange: string;
    preferredChannels: string[];
  };
  marketPotential: {
    totalCompanies: number;
    avgDealSize: string;
    conversionRate: string;
  };
  locations: {
    country: string;
    cities: string[];
    companies: number;
  }[];
  businesses: {
    id: string;
    name: string;
    country: string;
    city: string;
    matchScore: number;
  }[];
}

export default function BusinessPersonas() {
  const { state, updateSelectedPersonas } = useAppContext();
  const { getCurrentSearch } = useUserData();
  const { state: authState } = useAuth();
  const currentSearch = getCurrentSearch();
  
  // Real-time data hook for progressive loading
  const realTimeData = useRealTimeSearch(currentSearch?.id || null);
  // ONLY show business personas here. Do NOT fallback to DM personas to avoid role/person mix-up in UI
  const personasSource = useMemo(() => realTimeData.businessPersonas || [], [realTimeData.businessPersonas]);
  
  // UI state
  const [selectedPersona, setSelectedPersona] = useState<PersonaData | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedPersonas, setExpandedPersonas] = useState<string[]>([]);
  
  // Legacy demo state
  const [demoPersonas, setDemoPersonas] = useState<PersonaData[]>([]);
  const [isLoadingDemo, setIsLoadingDemo] = useState(true);
  
  // Determine if we're in demo mode
  const isDemo = isDemoUser(authState.user?.id, authState.user?.email);
  // Subtle toast for new items
  const [, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!isDemo && realTimeData.businesses.length > 0) {
      setToast('New businesses found');
      const t = setTimeout(() => setToast(null), 2000);
      return () => clearTimeout(t);
    }
  }, [realTimeData.businesses.length, isDemo]);
  useEffect(() => {
    if (!isDemo && realTimeData.decisionMakers.length > 0) {
      setToast('New decision makers found');
      const t = setTimeout(() => setToast(null), 2000);
      return () => clearTimeout(t);
    }
  }, [realTimeData.decisionMakers.length, isDemo]);
  
  // Use real-time data for real users, demo data for demo users (stable, no flicker)
  const personas: PersonaData[] = useMemo(() => {
    if (isDemo) return demoPersonas;
    const list = (personasSource || [])
      .filter(p => typeof p?.title === 'string' && p.title.trim().toLowerCase() !== 'persona generation failed')
      .sort((a, b) => ((a?.rank as number) ?? 999) - ((b?.rank as number) ?? 999))
      .slice(0, 3)
      .map((p) => {
    // Attach live-mapped businesses under each persona (progressive as they stream in)
      const personaBusinesses = (realTimeData.businesses || [])
        .filter(b => b.persona_id === (p as any).id)
        .map(b => ({
          id: b.id,
          name: b.name,
          country: b.country,
          city: b.city || '',
          matchScore: typeof b.match_score === 'number' ? b.match_score : 75
        }))
        .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));

      return {
        id: (p as any).id,
        title: (p as any).title as string,
        rank: (p as any).rank as number,
        matchScore: (p as any).match_score as number,
        demographics: {
          industry: (p as any).demographics?.industry ?? 'Technology',
          companySize: (p as any).demographics?.companySize ?? '100-1000 employees',
          geography: (p as any).demographics?.geography ?? 'Global',
          revenue: (p as any).demographics?.revenue ?? '$10M-100M'
        },
        characteristics: {
          painPoints: (p as any).characteristics?.painPoints ?? [],
          motivations: (p as any).characteristics?.motivations ?? [],
          challenges: (p as any).characteristics?.challenges ?? [],
          decisionFactors: (p as any).characteristics?.decisionFactors ?? []
        },
        behaviors: {
          buyingProcess: (p as any).behaviors?.buyingProcess ?? 'Standard evaluation process',
          decisionTimeline: (p as any).behaviors?.decisionTimeline ?? '3-6 months',
          budgetRange: (p as any).behaviors?.budgetRange ?? '$50K-500K',
          preferredChannels: (p as any).behaviors?.preferredChannels ?? []
        },
         marketPotential: {
           totalCompanies: (p as any).market_potential?.totalCompanies ?? 0,
           avgDealSize: (p as any).market_potential?.avgDealSize ?? '',
           conversionRate: (p as any).market_potential?.conversionRate ?? ''
         },
        locations: (p as any).locations ?? [],
        businesses: personaBusinesses
      } as PersonaData;
    });
    return list as PersonaData[];
  }, [isDemo, demoPersonas, personasSource, realTimeData.businesses]);
  
  // Show loader only until first persona arrives; do not block on phase value
  // Do not block the screen if businesses already exist or DM personas are available
  const isLoading = isDemo ? isLoadingDemo : (personas.length === 0 && realTimeData.businesses.length === 0);
  const hasSearch = isDemo ? demoPersonas.length > 0 : !!currentSearch;

  // Load demo data for demo users only
  useEffect(() => {
    if (isDemo) {
      setDemoPersonas(getStaticPersonas());
      setIsLoadingDemo(false);
    }
  }, [isDemo]);

  // Real-time progress logging
  useEffect(() => {
    if (!isDemo && currentSearch) {
      logger.debug('Business Personas real-time data', {
        search_id: currentSearch.id,
        phase: realTimeData.progress.phase,
        business_personas: realTimeData.businessPersonas.length,
        is_loading: realTimeData.isLoading
      });
    }
  }, [realTimeData, currentSearch, isDemo]);

  // Legacy function removed - now using real-time data only

  const getStaticPersonas = (): PersonaData[] => [
    {
      id: '1',
      title: 'Enterprise Technology Leader',
      rank: 1,
      matchScore: 95,
      demographics: {
        industry: 'Technology',
        companySize: '1000-5000 employees',
        geography: 'North America, Europe',
        revenue: '$100M-500M'
      },
      characteristics: {
        painPoints: ['Legacy system modernization', 'Scalability challenges', 'Integration complexity', 'Security concerns'],
        motivations: ['Digital transformation', 'Operational efficiency', 'Competitive advantage', 'Cost optimization'],
        challenges: ['Budget constraints', 'Change management', 'Technical debt', 'Vendor evaluation'],
        decisionFactors: ['ROI demonstration', 'Implementation timeline', 'Vendor stability', 'Support quality']
      },
      behaviors: {
        buyingProcess: 'Committee-based with 6-9 month evaluation',
        decisionTimeline: '6-9 months from initial contact',
        budgetRange: '$500K - $2M annually',
        preferredChannels: ['Direct sales', 'Industry conferences', 'Peer recommendations', 'Analyst reports']
      },
      marketPotential: {
        totalCompanies: 2500,
        avgDealSize: '$850K',
        conversionRate: '12%'
      },
      locations: [
        { country: 'United States', cities: ['San Francisco', 'New York', 'Seattle', 'Austin'], companies: 1200 },
        { country: 'United Kingdom', cities: ['London', 'Manchester', 'Edinburgh'], companies: 450 },
        { country: 'Germany', cities: ['Berlin', 'Munich', 'Hamburg'], companies: 380 },
        { country: 'Canada', cities: ['Toronto', 'Vancouver', 'Montreal'], companies: 320 },
        { country: 'France', cities: ['Paris', 'Lyon', 'Toulouse'], companies: 150 }
      ],
      businesses: [
        { id: '1', name: 'TechCorp Solutions', country: 'United States', city: 'San Francisco', matchScore: 95 },
        { id: '2', name: 'InnovateAI Systems', country: 'United States', city: 'New York', matchScore: 92 },
        { id: '3', name: 'CloudTech Enterprises', country: 'United Kingdom', city: 'London', matchScore: 90 },
        { id: '4', name: 'Digital Transform Ltd', country: 'Germany', city: 'Berlin', matchScore: 88 },
        { id: '5', name: 'Enterprise Solutions Inc', country: 'Canada', city: 'Toronto', matchScore: 85 }
      ]
    },
    {
      id: '2',
      title: 'Mid-Market Innovation Driver',
      rank: 2,
      matchScore: 88,
      demographics: {
        industry: 'Technology',
        companySize: '200-1000 employees',
        geography: 'North America, Europe, APAC',
        revenue: '$20M-100M'
      },
      characteristics: {
        painPoints: ['Resource limitations', 'Rapid growth scaling', 'Process automation', 'Market competition'],
        motivations: ['Growth acceleration', 'Process optimization', 'Market expansion', 'Innovation leadership'],
        challenges: ['Limited budget', 'Skill gaps', 'Time constraints', 'Technology selection'],
        decisionFactors: ['Cost-effectiveness', 'Quick implementation', 'Scalability', 'Ease of use']
      },
      behaviors: {
        buyingProcess: 'Streamlined with 3-6 month evaluation',
        decisionTimeline: '3-6 months from initial contact',
        budgetRange: '$100K - $500K annually',
        preferredChannels: ['Online research', 'Webinars', 'Direct sales', 'Partner referrals']
      },
      marketPotential: {
        totalCompanies: 4200,
        avgDealSize: '$275K',
        conversionRate: '18%'
      },
      locations: [
        { country: 'United States', cities: ['San Francisco', 'Austin', 'Denver', 'Boston'], companies: 1800 },
        { country: 'United Kingdom', cities: ['London', 'Bristol', 'Cambridge'], companies: 650 },
        { country: 'Germany', cities: ['Berlin', 'Munich', 'Cologne'], companies: 520 },
        { country: 'Australia', cities: ['Sydney', 'Melbourne', 'Brisbane'], companies: 480 },
        { country: 'Canada', cities: ['Toronto', 'Vancouver', 'Calgary'], companies: 420 },
        { country: 'Singapore', cities: ['Singapore'], companies: 330 }
      ],
      businesses: [
        { id: '6', name: 'InnovateTech Inc', country: 'United Kingdom', city: 'London', matchScore: 88 },
        { id: '7', name: 'GrowthTech Solutions', country: 'United States', city: 'Austin', matchScore: 85 },
        { id: '8', name: 'ScaleUp Systems', country: 'Germany', city: 'Berlin', matchScore: 82 },
        { id: '9', name: 'AgileCore Technologies', country: 'Australia', city: 'Sydney', matchScore: 80 },
        { id: '10', name: 'NextGen Platforms', country: 'Canada', city: 'Toronto', matchScore: 78 }
      ]
    },
    {
      id: '3',
      title: 'Healthcare Digital Transformer',
      rank: 3,
      matchScore: 85,
      demographics: {
        industry: 'Healthcare',
        companySize: '500-2000 employees',
        geography: 'North America, Europe',
        revenue: '$50M-200M'
      },
      characteristics: {
        painPoints: ['Regulatory compliance', 'Patient data security', 'Interoperability', 'Cost pressures'],
        motivations: ['Patient outcomes', 'Operational efficiency', 'Compliance assurance', 'Cost reduction'],
        challenges: ['Regulatory requirements', 'Legacy systems', 'Staff training', 'Budget approval'],
        decisionFactors: ['Compliance certification', 'Security features', 'Integration capabilities', 'Clinical evidence']
      },
      behaviors: {
        buyingProcess: 'Highly regulated with 9-12 month evaluation',
        decisionTimeline: '9-12 months from initial contact',
        budgetRange: '$300K - $1M annually',
        preferredChannels: ['Industry conferences', 'Clinical studies', 'Peer networks', 'Direct sales']
      },
      marketPotential: {
        totalCompanies: 1800,
        avgDealSize: '$650K',
        conversionRate: '8%'
      },
      locations: [
        { country: 'United States', cities: ['Boston', 'San Francisco', 'Chicago', 'Houston'], companies: 950 },
        { country: 'United Kingdom', cities: ['London', 'Oxford', 'Cambridge'], companies: 320 },
        { country: 'Germany', cities: ['Berlin', 'Munich', 'Frankfurt'], companies: 280 },
        { country: 'Canada', cities: ['Toronto', 'Montreal', 'Vancouver'], companies: 250 }
      ],
      businesses: [
        { id: '11', name: 'HealthTech Innovations', country: 'Canada', city: 'Toronto', matchScore: 92 },
        { id: '12', name: 'MedTech Solutions', country: 'United States', city: 'Boston', matchScore: 89 },
        { id: '13', name: 'Digital Health Corp', country: 'United Kingdom', city: 'London', matchScore: 87 },
        { id: '14', name: 'CareConnect Systems', country: 'Germany', city: 'Berlin', matchScore: 84 },
        { id: '15', name: 'PatientFirst Technologies', country: 'United States', city: 'San Francisco', matchScore: 82 }
      ]
    },
    {
      id: '4',
      title: 'Manufacturing Efficiency Expert',
      rank: 4,
      matchScore: 82,
      demographics: {
        industry: 'Manufacturing',
        companySize: '500-3000 employees',
        geography: 'Global',
        revenue: '$100M-1B'
      },
      characteristics: {
        painPoints: ['Production inefficiencies', 'Quality control', 'Supply chain disruption', 'Maintenance costs'],
        motivations: ['Operational excellence', 'Quality improvement', 'Cost reduction', 'Sustainability'],
        challenges: ['Capital investment', 'Downtime risks', 'Skill requirements', 'ROI justification'],
        decisionFactors: ['Proven results', 'Minimal disruption', 'Training support', 'Maintenance requirements']
      },
      behaviors: {
        buyingProcess: 'Engineering-led with 6-12 month evaluation',
        decisionTimeline: '6-12 months from initial contact',
        budgetRange: '$200K - $800K annually',
        preferredChannels: ['Trade shows', 'Technical demos', 'Case studies', 'Direct sales']
      },
      marketPotential: {
        totalCompanies: 3100,
        avgDealSize: '$450K',
        conversionRate: '15%'
      },
      locations: [
        { country: 'Germany', cities: ['Munich', 'Stuttgart', 'Cologne'], companies: 850 },
        { country: 'United States', cities: ['Detroit', 'Chicago', 'Houston', 'Milwaukee'], companies: 780 },
        { country: 'Japan', cities: ['Tokyo', 'Osaka', 'Nagoya'], companies: 620 },
        { country: 'China', cities: ['Shanghai', 'Shenzhen', 'Beijing'], companies: 580 },
        { country: 'United Kingdom', cities: ['Birmingham', 'Manchester', 'Sheffield'], companies: 270 }
      ],
      businesses: [
        { id: '16', name: 'Global Manufacturing Corp', country: 'Germany', city: 'Munich', matchScore: 82 },
        { id: '17', name: 'Industrial Solutions Inc', country: 'United States', city: 'Detroit', matchScore: 79 },
        { id: '18', name: 'AutoTech Manufacturing', country: 'Japan', city: 'Tokyo', matchScore: 77 },
        { id: '19', name: 'Precision Industries', country: 'China', city: 'Shanghai', matchScore: 75 },
        { id: '20', name: 'Advanced Manufacturing Ltd', country: 'United Kingdom', city: 'Birmingham', matchScore: 73 }
      ]
    },
    {
      id: '5',
      title: 'Financial Services Innovator',
      rank: 5,
      matchScore: 79,
      demographics: {
        industry: 'Financial Services',
        companySize: '1000-5000 employees',
        geography: 'North America, Europe',
        revenue: '$500M-5B'
      },
      characteristics: {
        painPoints: ['Regulatory compliance', 'Digital transformation', 'Customer experience', 'Risk management'],
        motivations: ['Customer satisfaction', 'Operational efficiency', 'Competitive advantage', 'Risk mitigation'],
        challenges: ['Regulatory changes', 'Legacy systems', 'Security requirements', 'Integration complexity'],
        decisionFactors: ['Regulatory compliance', 'Security standards', 'Scalability', 'Vendor reputation']
      },
      behaviors: {
        buyingProcess: 'Risk-averse with 12-18 month evaluation',
        decisionTimeline: '12-18 months from initial contact',
        budgetRange: '$1M - $5M annually',
        preferredChannels: ['Industry events', 'Regulatory briefings', 'Peer recommendations', 'Direct sales']
      },
      marketPotential: {
        totalCompanies: 800,
        avgDealSize: '$2.2M',
        conversionRate: '6%'
      },
      locations: [
        { country: 'United States', cities: ['New York', 'San Francisco', 'Chicago', 'Charlotte'], companies: 380 },
        { country: 'United Kingdom', cities: ['London', 'Edinburgh'], companies: 180 },
        { country: 'Switzerland', cities: ['Zurich', 'Geneva'], companies: 120 },
        { country: 'Germany', cities: ['Frankfurt', 'Munich'], companies: 120 }
      ],
      businesses: [
        { id: '21', name: 'Financial Services Group', country: 'United Kingdom', city: 'London', matchScore: 79 },
        { id: '22', name: 'Global Investment Bank', country: 'United States', city: 'New York', matchScore: 76 },
        { id: '23', name: 'Swiss Financial Corp', country: 'Switzerland', city: 'Zurich', matchScore: 74 },
        { id: '24', name: 'Deutsche Finance AG', country: 'Germany', city: 'Frankfurt', matchScore: 72 },
        { id: '25', name: 'Capital Markets Inc', country: 'United States', city: 'Chicago', matchScore: 70 }
      ]
    },
    {
      id: '6',
      title: 'Retail Digital Pioneer',
      rank: 6,
      matchScore: 76,
      demographics: {
        industry: 'Retail',
        companySize: '200-2000 employees',
        geography: 'Global',
        revenue: '$50M-500M'
      },
      characteristics: {
        painPoints: ['Omnichannel integration', 'Inventory management', 'Customer analytics', 'Market competition'],
        motivations: ['Customer experience', 'Sales growth', 'Operational efficiency', 'Market share'],
        challenges: ['Seasonal fluctuations', 'Technology integration', 'Staff training', 'Budget cycles'],
        decisionFactors: ['Customer impact', 'Implementation speed', 'Scalability', 'Cost-effectiveness']
      },
      behaviors: {
        buyingProcess: 'Fast-paced with 3-6 month evaluation',
        decisionTimeline: '3-6 months from initial contact',
        budgetRange: '$150K - $600K annually',
        preferredChannels: ['Online research', 'Retail conferences', 'Demo requests', 'Partner channels']
      },
      marketPotential: {
        totalCompanies: 5200,
        avgDealSize: '$320K',
        conversionRate: '22%'
      },
      locations: [
        { country: 'United States', cities: ['New York', 'Los Angeles', 'Chicago', 'Atlanta'], companies: 2100 },
        { country: 'United Kingdom', cities: ['London', 'Manchester', 'Birmingham'], companies: 850 },
        { country: 'Germany', cities: ['Berlin', 'Hamburg', 'Munich'], companies: 720 },
        { country: 'France', cities: ['Paris', 'Lyon', 'Marseille'], companies: 650 },
        { country: 'Australia', cities: ['Sydney', 'Melbourne'], companies: 480 },
        { country: 'Canada', cities: ['Toronto', 'Vancouver'], companies: 400 }
      ],
      businesses: [
        { id: '26', name: 'Retail Dynamics', country: 'Australia', city: 'Sydney', matchScore: 76 },
        { id: '27', name: 'OmniChannel Solutions', country: 'United States', city: 'New York', matchScore: 73 },
        { id: '28', name: 'Digital Retail Corp', country: 'United Kingdom', city: 'London', matchScore: 71 },
        { id: '29', name: 'E-Commerce Innovations', country: 'Germany', city: 'Berlin', matchScore: 69 },
        { id: '30', name: 'Retail Tech Solutions', country: 'Canada', city: 'Toronto', matchScore: 67 }
      ]
    },
    {
      id: '7',
      title: 'Energy Sector Modernizer',
      rank: 7,
      matchScore: 73,
      demographics: {
        industry: 'Energy',
        companySize: '1000-10000 employees',
        geography: 'Global',
        revenue: '$1B-10B'
      },
      characteristics: {
        painPoints: ['Infrastructure aging', 'Environmental regulations', 'Grid modernization', 'Safety compliance'],
        motivations: ['Sustainability', 'Operational reliability', 'Cost optimization', 'Regulatory compliance'],
        challenges: ['Capital intensity', 'Regulatory approval', 'Technical complexity', 'Long project cycles'],
        decisionFactors: ['Proven technology', 'Regulatory approval', 'Long-term support', 'Environmental impact']
      },
      behaviors: {
        buyingProcess: 'Highly structured with 18-24 month evaluation',
        decisionTimeline: '18-24 months from initial contact',
        budgetRange: '$2M - $10M annually',
        preferredChannels: ['Industry conferences', 'Technical presentations', 'Pilot programs', 'Direct sales']
      },
      marketPotential: {
        totalCompanies: 400,
        avgDealSize: '$4.5M',
        conversionRate: '4%'
      },
      locations: [
        { country: 'United States', cities: ['Houston', 'Denver', 'Dallas'], companies: 150 },
        { country: 'Norway', cities: ['Oslo', 'Stavanger'], companies: 80 },
        { country: 'United Kingdom', cities: ['Aberdeen', 'London'], companies: 70 },
        { country: 'Germany', cities: ['Hamburg', 'Berlin'], companies: 60 },
        { country: 'Canada', cities: ['Calgary', 'Toronto'], companies: 40 }
      ],
      businesses: [
        { id: '31', name: 'Energy Solutions Ltd', country: 'Norway', city: 'Oslo', matchScore: 73 },
        { id: '32', name: 'Renewable Power Corp', country: 'United States', city: 'Houston', matchScore: 70 },
        { id: '33', name: 'Green Energy Systems', country: 'United Kingdom', city: 'Aberdeen', matchScore: 68 },
        { id: '34', name: 'Sustainable Energy AG', country: 'Germany', city: 'Hamburg', matchScore: 66 },
        { id: '35', name: 'Clean Power Solutions', country: 'Canada', city: 'Calgary', matchScore: 64 }
      ]
    },
    {
      id: '8',
      title: 'Education Technology Adopter',
      rank: 8,
      matchScore: 70,
      demographics: {
        industry: 'Education',
        companySize: '500-5000 employees',
        geography: 'North America, Europe',
        revenue: '$20M-200M'
      },
      characteristics: {
        painPoints: ['Budget constraints', 'Technology adoption', 'Student engagement', 'Administrative efficiency'],
        motivations: ['Student outcomes', 'Operational efficiency', 'Cost management', 'Innovation leadership'],
        challenges: ['Funding limitations', 'Change resistance', 'Training requirements', 'Integration complexity'],
        decisionFactors: ['Educational impact', 'Cost-effectiveness', 'Ease of use', 'Support quality']
      },
      behaviors: {
        buyingProcess: 'Committee-based with 6-12 month evaluation',
        decisionTimeline: '6-12 months from initial contact',
        budgetRange: '$100K - $500K annually',
        preferredChannels: ['Education conferences', 'Pilot programs', 'Peer recommendations', 'Grant applications']
      },
      marketPotential: {
        totalCompanies: 2800,
        avgDealSize: '$280K',
        conversionRate: '14%'
      },
      locations: [
        { country: 'United States', cities: ['Boston', 'San Francisco', 'Austin', 'Raleigh'], companies: 1400 },
        { country: 'United Kingdom', cities: ['London', 'Oxford', 'Cambridge'], companies: 520 },
        { country: 'Canada', cities: ['Toronto', 'Vancouver', 'Montreal'], companies: 380 },
        { country: 'Australia', cities: ['Sydney', 'Melbourne'], companies: 320 },
        { country: 'Germany', cities: ['Berlin', 'Munich'], companies: 180 }
      ],
      businesses: [
        { id: '36', name: 'EduTech University', country: 'United States', city: 'Boston', matchScore: 70 },
        { id: '37', name: 'Learning Innovations Ltd', country: 'United Kingdom', city: 'London', matchScore: 67 },
        { id: '38', name: 'Digital Education Corp', country: 'Canada', city: 'Toronto', matchScore: 65 },
        { id: '39', name: 'EdTech Solutions', country: 'Australia', city: 'Sydney', matchScore: 63 },
        { id: '40', name: 'Smart Learning Systems', country: 'Germany', city: 'Berlin', matchScore: 61 }
      ]
    },
    {
      id: '9',
      title: 'Government Digital Modernizer',
      rank: 9,
      matchScore: 67,
      demographics: {
        industry: 'Government',
        companySize: '1000-50000 employees',
        geography: 'North America, Europe',
        revenue: '$100M-10B'
      },
      characteristics: {
        painPoints: ['Legacy systems', 'Citizen services', 'Security requirements', 'Budget approval'],
        motivations: ['Public service', 'Operational efficiency', 'Transparency', 'Cost savings'],
        challenges: ['Procurement processes', 'Political cycles', 'Security clearance', 'Compliance requirements'],
        decisionFactors: ['Security certification', 'Compliance standards', 'Vendor stability', 'Cost transparency']
      },
      behaviors: {
        buyingProcess: 'Formal procurement with 12-24 month evaluation',
        decisionTimeline: '12-24 months from initial contact',
        budgetRange: '$500K - $5M annually',
        preferredChannels: ['Government conferences', 'RFP responses', 'Partner channels', 'Direct sales']
      },
      marketPotential: {
        totalCompanies: 600,
        avgDealSize: '$1.8M',
        conversionRate: '8%'
      },
      locations: [
        { country: 'United States', cities: ['Washington DC', 'Austin', 'Sacramento'], companies: 280 },
        { country: 'United Kingdom', cities: ['London', 'Manchester'], companies: 120 },
        { country: 'Canada', cities: ['Ottawa', 'Toronto'], companies: 100 },
        { country: 'Australia', cities: ['Canberra', 'Sydney'], companies: 80 },
        { country: 'Germany', cities: ['Berlin', 'Munich'], companies: 20 }
      ],
      businesses: [
        { id: '41', name: 'City Government Services', country: 'Canada', city: 'Ottawa', matchScore: 67 },
        { id: '42', name: 'Federal Digital Services', country: 'United States', city: 'Washington DC', matchScore: 64 },
        { id: '43', name: 'Public Sector Solutions', country: 'United Kingdom', city: 'London', matchScore: 62 },
        { id: '44', name: 'Government Tech Corp', country: 'Australia', city: 'Canberra', matchScore: 60 },
        { id: '45', name: 'Digital Government AG', country: 'Germany', city: 'Berlin', matchScore: 58 }
      ]
    },
    {
      id: '10',
      title: 'Startup Growth Accelerator',
      rank: 10,
      matchScore: 64,
      demographics: {
        industry: 'Technology',
        companySize: '10-200 employees',
        geography: 'Global',
        revenue: '$1M-20M'
      },
      characteristics: {
        painPoints: ['Resource constraints', 'Rapid scaling', 'Market validation', 'Funding pressure'],
        motivations: ['Growth acceleration', 'Market penetration', 'Operational efficiency', 'Investor satisfaction'],
        challenges: ['Limited budget', 'Time pressure', 'Skill gaps', 'Technology selection'],
        decisionFactors: ['Cost-effectiveness', 'Quick implementation', 'Scalability', 'Support quality']
      },
      behaviors: {
        buyingProcess: 'Agile with 1-3 month evaluation',
        decisionTimeline: '1-3 months from initial contact',
        budgetRange: '$10K - $100K annually',
        preferredChannels: ['Online research', 'Startup events', 'Social media', 'Free trials']
      },
      marketPotential: {
        totalCompanies: 15000,
        avgDealSize: '$45K',
        conversionRate: '35%'
      },
      locations: [
        { country: 'United States', cities: ['San Francisco', 'New York', 'Austin', 'Seattle'], companies: 8500 },
        { country: 'United Kingdom', cities: ['London', 'Manchester', 'Edinburgh'], companies: 2200 },
        { country: 'Germany', cities: ['Berlin', 'Munich', 'Hamburg'], companies: 1800 },
        { country: 'Canada', cities: ['Toronto', 'Vancouver'], companies: 1200 },
        { country: 'Australia', cities: ['Sydney', 'Melbourne'], companies: 800 },
        { country: 'Singapore', cities: ['Singapore'], companies: 500 }
      ],
      businesses: [
        { id: '46', name: 'StartupHub Accelerator', country: 'Singapore', city: 'Singapore', matchScore: 64 },
        { id: '47', name: 'TechStart Ventures', country: 'United States', city: 'San Francisco', matchScore: 61 },
        { id: '48', name: 'Innovation Labs Inc', country: 'United Kingdom', city: 'London', matchScore: 59 },
        { id: '49', name: 'Startup Solutions GmbH', country: 'Germany', city: 'Berlin', matchScore: 57 },
        { id: '50', name: 'Growth Accelerator Ltd', country: 'Australia', city: 'Sydney', matchScore: 55 }
      ]
    }
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h3 className="text-lg font-semibold text-gray-900">Generating business personas...</h3>
          <p className="text-gray-600">AI agents are analyzing your search criteria to create targeted personas</p>
        </div>
      </div>
    );
  }

  // Show empty state for real users without any searches
  if (!hasSearch && !isDemoUser(authState.user?.id, authState.user?.email)) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center max-w-md">
          <Search className="w-24 h-24 text-gray-300 mx-auto mb-6" />
          <h3 className="text-2xl font-semibold text-gray-900 mb-4">No Business Personas Yet</h3>
          <p className="text-gray-600 mb-8">
            Start a search to discover and analyze business personas that match your product or service.
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

  const togglePersonaExpansion = (personaId: string) => {
    setExpandedPersonas(prev => 
      prev.includes(personaId) 
        ? prev.filter(id => id !== personaId)
        : [...prev, personaId]
    );
  };

  const handleProceedToBusinessResults = () => {
    // Pass selected personas to context for filtering in business results
    updateSelectedPersonas(personas as unknown as any[]);
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'results' }));
  };

  const handleViewBusinessesForPersona = (persona: PersonaData) => {
    // Set the selected persona for filtering and navigate to results
    updateSelectedPersonas([persona] as unknown as any[]);
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'results' }));
  };
  const tabs = [
    { id: 'overview', label: 'Overview', icon: Target },
    { id: 'characteristics', label: 'Characteristics', icon: Users },
    { id: 'behaviors', label: 'Behaviors', icon: Building }
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Business Personas for "{state.searchData?.productService}"
          </h1>
          <p className="text-gray-600 mt-2">
            Ranked personas for businesses {state.searchData?.type === 'customer' ? 'needing' : 'providing'} your product/service
          </p>
          {(!isDemo && realTimeData.progress.phase !== 'completed') && (
            <div className="mt-2 text-sm text-blue-600">More businesses loading...</div>
          )}
        </div>
        <button
          onClick={handleProceedToBusinessResults}
          className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <span>Next: View Businesses</span>
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        {/* Personas List */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Ranked Business Personas</h2>
          
          {personas.length === 0 && (
            <div className="space-y-4">
              {/* Loading skeletons when personas haven't arrived yet */}
              {realTimeData.progress.phase !== 'completed' ? (
                [0,1,2].map((i) => (
                  <div key={`skeleton-${i}`} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-pulse">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-start space-x-4 w-full">
                        <div className="w-12 h-12 rounded-full bg-gray-200" />
                        <div className="flex-1 space-y-2">
                          <div className="h-4 bg-gray-200 rounded w-1/3" />
                          <div className="h-3 bg-gray-100 rounded w-1/2" />
                          <div className="h-3 bg-gray-100 rounded w-1/4" />
                        </div>
                      </div>
                      <div className="w-20 h-6 bg-gray-200 rounded" />
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                      <div className="h-4 bg-gray-100 rounded" />
                      <div className="h-4 bg-gray-100 rounded" />
                      <div className="h-4 bg-gray-100 rounded" />
                    </div>
                    <div className="flex gap-2">
                      <div className="h-6 w-20 bg-gray-100 rounded" />
                      <div className="h-6 w-24 bg-gray-100 rounded" />
                      <div className="h-6 w-16 bg-gray-100 rounded" />
                    </div>
                  </div>
                ))
              ) : (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
                  <p className="text-gray-700">No business personas were generated for this search.</p>
                  <p className="text-gray-500 text-sm mt-1">You can proceed to view businesses or run a new search.</p>
                </div>
              )}
            </div>
          )}
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
                      <p className="text-gray-600 mt-1">{persona.demographics.industry} • {persona.demographics.companySize}</p>
                      <p className="text-sm text-gray-500">{persona.demographics.geography}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`px-3 py-1 rounded-full text-sm font-medium mb-2 ${getMatchScoreColor(persona.matchScore)}`}>
                      <Star className="w-4 h-4 inline mr-1" />
                      {persona.matchScore}% match
                    </div>
                    <div className="text-sm text-gray-500">
                      {persona.marketPotential.totalCompanies.toLocaleString()} companies
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                  <div className="flex items-center space-x-2 text-gray-600">
                    <DollarSign className="w-4 h-4" />
                    <span>{persona.marketPotential.avgDealSize}</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-600">
                    <TrendingUp className="w-4 h-4" />
                    <span>{persona.marketPotential.conversionRate} conversion</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-600">
                    <Building className="w-4 h-4" />
                    <span>{persona.demographics.revenue}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                  {persona.characteristics.painPoints.slice(0, 2).map((point) => (
                    <span key={`${persona.id}-pain-${point.slice(0, 20)}`} className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full">
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

              {/* Business Preview Dropdown */}
              <div className="border-t border-gray-200">
                <button
                  onClick={() => togglePersonaExpansion(persona.id)}
                  className="w-full flex items-center justify-between px-6 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center space-x-2">
                    <Eye className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700">
                      View Businesses ({persona.businesses.length} top matches)
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
                      {persona.businesses.map((business) => (
                        <div key={business.id} className="bg-white rounded-lg p-4 border border-gray-200 hover:border-blue-300 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <h4 className="font-medium text-gray-900">{business.name}</h4>
                              <p className="text-sm text-gray-600">{business.city}, {business.country}</p>
                            </div>
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              business.matchScore >= 90 ? 'bg-green-100 text-green-800' :
                              business.matchScore >= 80 ? 'bg-blue-100 text-blue-800' :
                              'bg-yellow-100 text-yellow-800'
                            }`}>
                              {business.matchScore}% match
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 pt-3 border-t border-gray-200">
                      <button
                        onClick={() => handleViewBusinessesForPersona(persona)}
                        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                      >
                        View All Businesses for {persona.title}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Persona Details */}
        <div className="lg:sticky lg:top-8">
          {selectedPersona ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="border-b border-gray-200">
                <nav className="flex space-x-6 px-6 overflow-x-auto no-scrollbar">
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
                            <span className="text-blue-700">Total Companies:</span>
                            <span className="font-semibold text-blue-900">{selectedPersona.marketPotential.totalCompanies.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-blue-700">Avg Deal Size:</span>
                            <span className="font-semibold text-blue-900">{selectedPersona.marketPotential.avgDealSize}</span>
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
                            <span className="text-green-700">Industry:</span>
                            <span className="font-semibold text-green-900">{selectedPersona.demographics.industry}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-green-700">Company Size:</span>
                            <span className="font-semibold text-green-900">{selectedPersona.demographics.companySize}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-green-700">Revenue:</span>
                            <span className="font-semibold text-green-900">{selectedPersona.demographics.revenue}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-3">Top Pain Points</h4>
                        <div className="space-y-2">
                          {selectedPersona.characteristics.painPoints.map((point) => (
                            <div key={`${selectedPersona.id}-detail-pain-${point.slice(0, 20)}`} className="flex items-start space-x-2">
                              <div className="w-2 h-2 bg-red-500 rounded-full mt-2 flex-shrink-0"></div>
                              <span className="text-gray-700 text-sm">{point}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h4 className="font-semibold text-gray-900 mb-3">Key Motivations</h4>
                        <div className="space-y-2">
                          {selectedPersona.characteristics.motivations.map((motivation) => (
                            <div key={`${selectedPersona.id}-detail-motivation-${motivation.slice(0, 20)}`} className="flex items-start space-x-2">
                              <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
                              <span className="text-gray-700 text-sm">{motivation}</span>
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
                          {selectedPersona.characteristics.painPoints.map((point) => (
                            <div key={`${selectedPersona.id}-char-pain-${point.slice(0, 20)}`} className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                              <span className="text-red-800 text-sm">{point}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                        <h4 className="font-semibold text-green-900 mb-3">Motivations</h4>
                        <div className="space-y-2">
                          {selectedPersona.characteristics.motivations.map((motivation) => (
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
                          {selectedPersona.characteristics.challenges.map((challenge) => (
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
                          {selectedPersona.characteristics.decisionFactors.map((factor) => (
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
                          <h4 className="font-semibold text-gray-900 mb-2">Buying Process</h4>
                          <p className="text-gray-700 text-sm">{selectedPersona.behaviors?.buyingProcess ?? 'Unknown'}</p>
                        </div>

                        <div className="bg-white border border-gray-200 rounded-xl p-4">
                          <h4 className="font-semibold text-gray-900 mb-2">Decision Timeline</h4>
                          <p className="text-gray-700 text-sm">{selectedPersona.behaviors?.decisionTimeline ?? 'Unknown'}</p>
                        </div>

                        <div className="bg-white border border-gray-200 rounded-xl p-4">
                          <h4 className="font-semibold text-gray-900 mb-2">Budget Range</h4>
                          <p className="text-gray-700 text-sm">{selectedPersona.behaviors?.budgetRange ?? 'Unknown'}</p>
                        </div>
                      </div>

                      <div>
                        <div className="bg-white border border-gray-200 rounded-xl p-4">
                          <h4 className="font-semibold text-gray-900 mb-3">Preferred Channels</h4>
                          <div className="space-y-2">
                            {(selectedPersona.behaviors?.preferredChannels ?? []).map((channel) => (
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
              <Target className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Business Persona</h3>
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