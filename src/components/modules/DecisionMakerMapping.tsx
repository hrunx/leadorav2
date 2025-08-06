import React, { useState, useEffect, useRef } from 'react';
import { Building, User, Crown, Shield, Users, Plus, Save, ArrowRight, Target, TrendingUp, Filter, UserCheck, Mail, Phone, Linkedin, MapPin, Calendar, Briefcase, Award, MessageSquare, Search } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { useUserData } from '../../context/UserDataContext';
import { useAuth } from '../../context/AuthContext';
import { SearchService } from '../../services/searchService';
import { useDemoMode } from '../../hooks/useDemoMode';
import { supabase } from '../../lib/supabase';

import { DEMO_USER_ID, DEMO_USER_EMAIL, isDemoUser } from '../../constants/demo';

interface DecisionMaker {
  id: string;
  name: string;
  title: string;
  level: 'executive' | 'director' | 'manager' | 'individual';
  influence: number;
  department: string;
  company: string;
  location: string;
  email: string;
  phone: string;
  linkedin: string;
  experience: string;
  communicationPreference: string;
  painPoints: string[];
  motivations: string[];
  decisionFactors: string[];
  reportingTo?: string;
  personaType: string;
  companyContext: {
    industry: string;
    size: string;
    revenue: string;
    challenges: string[];
    priorities: string[];
  };
  personalizedApproach: {
    keyMessage: string;
    valueProposition: string;
    approachStrategy: string;
    bestContactTime: string;
    preferredChannel: string;
  };
  enrichmentStatus?: 'pending' | 'done';
  business?: {
    id: string;
    name: string;
    industry: string;
    country: string;
    city: string;
    size: string;
    revenue: string;
    description: string;
    rating?: number;
    address?: string;
    phone?: string;
    website?: string;
  };
}

export default function DecisionMakerMapping() {
  const { state, updateDecisionMakers } = useAppContext();
  const { getCurrentSearch } = useUserData();
  const { state: authState } = useAuth();
  // Simple demo user detection
  const isDemoUser = (userId?: string | null, userEmail?: string | null) => {
    return userId === DEMO_USER_ID || userId === 'demo-user' || userEmail === DEMO_USER_EMAIL;
  };
  const [filterPersona, setFilterPersona] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<DecisionMaker | null>(null);
  const [decisionMakers, setDecisionMakers] = useState<DecisionMaker[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasSearch, setHasSearch] = useState(false);
  const subscriptionRef = useRef<any>(null);
  const currentSearchIdRef = useRef<string | null>(null);

// Disable auto-filter so all decision makers show by default
  // If you want to re-enable filtering when a persona chip is clicked elsewhere,
  // uncomment the block below.
  /*
  useEffect(() => {
    if (state.selectedDecisionMakerPersonas && state.selectedDecisionMakerPersonas.length === 1) {
      setFilterPersona(state.selectedDecisionMakerPersonas[0].title);
    }
  }, [state.selectedDecisionMakerPersonas]);
  */

  // Load data on component mount
  useEffect(() => {
    loadDecisionMakers();
  }, [getCurrentSearch, authState.user]);

  // Setup realtime subscription for decision maker updates
  useEffect(() => {
    const currentSearch = getCurrentSearch();
    const isDemo = isDemoUser(authState.user?.id, authState.user?.email);
    
    // If no search or demo user, clean up any existing subscription
    if (!currentSearch || isDemo) {
      if (subscriptionRef.current) {
        console.log('Cleaning up decision makers realtime subscription (no search/demo)');
        supabase.removeChannel(subscriptionRef.current);
        subscriptionRef.current = null;
        currentSearchIdRef.current = null;
      }
      return;
    }

    // If search hasn't changed, don't recreate subscription
    if (currentSearchIdRef.current === currentSearch.id && subscriptionRef.current) {
      return;
    }

    // Clean up existing subscription if search changed
    if (subscriptionRef.current) {
      console.log('Cleaning up previous decision makers realtime subscription');
      supabase.removeChannel(subscriptionRef.current);
    }

    console.log(`Setting up realtime subscription for decision makers in search ${currentSearch.id}`);
    currentSearchIdRef.current = currentSearch.id;

    const channel = supabase
      .channel(`decision-makers-${currentSearch.id}`)
      .on('postgres_changes', 
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'decision_makers',
          filter: `search_id=eq.${currentSearch.id}`
        }, 
        (payload) => {
          console.log('New decision maker inserted:', payload.new);
          const newDM = payload.new as any;
          const enrichment = newDM.enrichment || {};
          
          const transformedDM: DecisionMaker = {
            id: newDM.id,
            name: newDM.name,
            title: newDM.title,
            level: newDM.level as 'executive' | 'director' | 'manager' | 'individual',
            influence: newDM.influence,
            department: newDM.department,
            company: newDM.company,
            location: newDM.location,
            email: newDM.email || '',
            phone: newDM.phone || '',
            linkedin: newDM.linkedin || '',
            experience: newDM.experience || enrichment.experience_level || '',
            communicationPreference: newDM.communication_preference || enrichment.communication_preference || '',
            painPoints: newDM.pain_points || enrichment.pain_points || [],
            motivations: newDM.motivations || enrichment.motivations || [],
            decisionFactors: newDM.decision_factors || enrichment.decision_factors || [],
            personaType: newDM.persona_type,
            companyContext: newDM.company_context || {
              industry: '',
              size: '',
              revenue: '',
              challenges: enrichment.current_challenges || [],
              priorities: []
            },
            personalizedApproach: newDM.personalized_approach || {
              keyMessage: '',
              valueProposition: '',
              approachStrategy: '',
              bestContactTime: enrichment.best_contact_time || '',
              preferredChannel: enrichment.preferred_contact_method || ''
            },
            enrichmentStatus: newDM.enrichment_status || 'pending',
            business: newDM.business
          };
          
          setDecisionMakers(prev => {
            // Avoid duplicates
            if (prev.find(dm => dm.id === transformedDM.id)) return prev;
            return [...prev, transformedDM];
          });
        }
      )
      .on('postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'decision_makers',
          filter: `search_id=eq.${currentSearch.id}`
        },
        (payload) => {
          console.log('Decision maker updated (enrichment):', payload.new);
          const updatedDM = payload.new as any;
          const enrichment = updatedDM.enrichment || {};
          
          setDecisionMakers(prev => 
            prev.map(dm => {
              if (dm.id === updatedDM.id) {
                return {
                  ...dm,
                  experience: updatedDM.experience || enrichment.experience_level || dm.experience,
                  communicationPreference: updatedDM.communication_preference || enrichment.communication_preference || dm.communicationPreference,
                  painPoints: updatedDM.pain_points || enrichment.pain_points || dm.painPoints,
                  motivations: updatedDM.motivations || enrichment.motivations || dm.motivations,
                  decisionFactors: updatedDM.decision_factors || enrichment.decision_factors || dm.decisionFactors,
                  companyContext: {
                    ...dm.companyContext,
                    challenges: enrichment.current_challenges || dm.companyContext.challenges
                  },
                  personalizedApproach: {
                    ...dm.personalizedApproach,
                    bestContactTime: enrichment.best_contact_time || dm.personalizedApproach.bestContactTime,
                    preferredChannel: enrichment.preferred_contact_method || dm.personalizedApproach.preferredChannel
                  },
                  enrichmentStatus: updatedDM.enrichment_status || 'pending'
                };
              }
              return dm;
            })
          );
        }
      )
      .subscribe();

    subscriptionRef.current = channel;

    return () => {
      if (subscriptionRef.current) {
        console.log('Cleaning up decision makers realtime subscription');
        supabase.removeChannel(subscriptionRef.current);
        subscriptionRef.current = null;
        currentSearchIdRef.current = null;
      }
    };
  }, [getCurrentSearch, authState.user]);

  const loadDecisionMakers = async () => {
    setIsLoading(true);
    try {
      const currentSearch = getCurrentSearch();
      const isDemo = isDemoUser(authState.user?.id, authState.user?.email);
      
      if (isDemo) {
        setDecisionMakers(getStaticDecisionMakers());
        setHasSearch(true);
      } else if (!currentSearch) {
        setDecisionMakers([]);
        setHasSearch(false);
      } else {
        // Load real data from database using SearchService
        const dmData = await SearchService.getDecisionMakers(currentSearch.id);
        const transformedData = dmData.map(dm => {
          // Handle enrichment data if available
          const enrichment = dm.enrichment || {};
          
          return {
            id: dm.id,
            name: dm.name,
            title: dm.title,
            level: dm.level as 'executive' | 'director' | 'manager' | 'individual',
            influence: dm.influence,
            department: dm.department,
            company: dm.company,
            location: dm.location,
            email: dm.email || '',
            phone: dm.phone || '',
            linkedin: dm.linkedin || '',
            experience: dm.experience || enrichment.experience_level || '',
            communicationPreference: dm.communication_preference || enrichment.communication_preference || '',
            painPoints: dm.pain_points || enrichment.pain_points || [],
            motivations: dm.motivations || enrichment.motivations || [],
            decisionFactors: dm.decision_factors || enrichment.decision_factors || [],
            personaType: dm.persona_type,
            companyContext: dm.company_context || {
              industry: dm.business?.industry || '',
              size: dm.business?.size || '',
              revenue: dm.business?.revenue || '',
              challenges: enrichment.current_challenges || [],
              priorities: []
            },
            personalizedApproach: dm.personalized_approach || {
              keyMessage: '',
              valueProposition: '',
              approachStrategy: '',
              bestContactTime: enrichment.best_contact_time || '',
              preferredChannel: enrichment.preferred_contact_method || ''
            },
            // Add enrichment status for UI indicators
            enrichmentStatus: dm.enrichment_status || 'pending',
            // Include business context if available
            business: dm.business
          };
        });
        setDecisionMakers(transformedData);
        setHasSearch(true);
      }
    } catch (error) {
      console.error('Error loading decision makers:', error);
      setDecisionMakers([]);
      setHasSearch(false);
    } finally {
      setIsLoading(false);
    }
  };

  const getStaticDecisionMakers = (): DecisionMaker[] => [
    {
      id: '1',
      name: 'Sarah Johnson',
      title: 'Chief Technology Officer',
      level: 'executive',
      influence: 95,
      department: 'Technology',
      company: 'TechCorp Solutions',
      location: 'San Francisco, CA',
      email: 'sarah.johnson@techcorp.com',
      phone: '+1 (555) 123-4567',
      linkedin: 'linkedin.com/in/sarahjohnson',
      experience: '15+ years in enterprise technology',
      communicationPreference: 'Strategic Vision & ROI Focus',
      painPoints: ['Digital transformation complexity', 'Legacy system modernization', 'Cybersecurity threats', 'Technology ROI measurement'],
      motivations: ['Innovation leadership', 'Competitive advantage', 'Operational efficiency', 'Business growth enablement'],
      decisionFactors: ['Strategic alignment', 'Scalability potential', 'Security features', 'Vendor stability'],
      personaType: 'Chief Technology Officer',
      companyContext: {
        industry: 'Enterprise Software',
        size: '2500 employees',
        revenue: '$250M annually',
        challenges: ['Scaling technology infrastructure', 'Digital transformation', 'Talent acquisition'],
        priorities: ['Cloud migration', 'AI implementation', 'Security enhancement']
      },
      personalizedApproach: {
        keyMessage: 'Accelerate your digital transformation with proven enterprise solutions that deliver measurable ROI',
        valueProposition: 'Reduce implementation time by 40% while ensuring enterprise-grade security and scalability',
        approachStrategy: 'Lead with strategic vision, demonstrate clear ROI, provide case studies from similar enterprises',
        bestContactTime: 'Tuesday-Thursday, 9-11 AM PST',
        preferredChannel: 'Executive briefing or strategic consultation'
      }
    },
    {
      id: '2',
      name: 'Michael Chen',
      title: 'VP of Engineering',
      level: 'director',
      influence: 80,
      department: 'Engineering',
      company: 'InnovateTech Inc',
      location: 'London, UK',
      email: 'michael.chen@innovatetech.com',
      phone: '+44 20 7123 4567',
      linkedin: 'linkedin.com/in/michaelchen',
      experience: '12+ years in software engineering',
      communicationPreference: 'Technical Details & Implementation',
      painPoints: ['Technical debt management', 'Team productivity', 'Development velocity', 'Code quality assurance'],
      motivations: ['Technical excellence', 'Team efficiency', 'Innovation delivery', 'System reliability'],
      decisionFactors: ['Technical merit', 'Development efficiency', 'Team adoption ease', 'Maintenance overhead'],
      personaType: 'VP of Engineering',
      companyContext: {
        industry: 'Technology Services',
        size: '450 employees',
        revenue: '$65M annually',
        challenges: ['Rapid scaling', 'Technical debt', 'Team coordination'],
        priorities: ['Development automation', 'Code quality improvement', 'Team productivity']
      },
      personalizedApproach: {
        keyMessage: 'Boost your engineering team productivity with tools that integrate seamlessly into existing workflows',
        valueProposition: 'Increase development velocity by 30% while maintaining code quality and reducing technical debt',
        approachStrategy: 'Focus on technical implementation, provide hands-on demos, share engineering best practices',
        bestContactTime: 'Monday-Wednesday, 2-4 PM GMT',
        preferredChannel: 'Technical demo or proof of concept'
      }
    },
    {
      id: '3',
      name: 'Dr. Amanda Lee',
      title: 'Chief Data Officer',
      level: 'executive',
      influence: 85,
      department: 'Data & Analytics',
      company: 'HealthTech Innovations',
      location: 'Toronto, Canada',
      email: 'amanda.lee@healthtech.com',
      phone: '+1 (416) 555-7890',
      linkedin: 'linkedin.com/in/dramandlee',
      experience: '12+ years in data science and analytics',
      communicationPreference: 'Data-driven Insights & Analytics',
      painPoints: ['Data silos across departments', 'Analytics adoption', 'Privacy compliance', 'Data quality issues'],
      motivations: ['Data-driven decision making', 'Business insights generation', 'Competitive intelligence', 'Operational optimization'],
      decisionFactors: ['Data integration capabilities', 'Analytics power', 'Compliance features', 'Scalability'],
      personaType: 'Chief Data Officer',
      companyContext: {
        industry: 'Healthcare Technology',
        size: '850 employees',
        revenue: '$120M annually',
        challenges: ['Data integration', 'Regulatory compliance', 'Analytics adoption'],
        priorities: ['Unified data platform', 'Advanced analytics', 'Compliance automation']
      },
      personalizedApproach: {
        keyMessage: 'Transform your healthcare data into actionable insights while ensuring complete regulatory compliance',
        valueProposition: 'Achieve 360-degree data visibility with HIPAA-compliant analytics that drive clinical outcomes',
        approachStrategy: 'Lead with data insights, demonstrate compliance features, show healthcare-specific use cases',
        bestContactTime: 'Tuesday-Thursday, 10 AM-12 PM EST',
        preferredChannel: 'Data analytics workshop or compliance briefing'
      }
    },
    {
      id: '4',
      name: 'Kevin Brown',
      title: 'Director of IT',
      level: 'director',
      influence: 75,
      department: 'Information Technology',
      company: 'Global Manufacturing Corp',
      location: 'Munich, Germany',
      email: 'kevin.brown@globalmanuf.com',
      phone: '+49 89 1234 5678',
      linkedin: 'linkedin.com/in/kevinbrown',
      experience: '10+ years in IT infrastructure',
      communicationPreference: 'Operational Efficiency & Cost Control',
      painPoints: ['System integration complexity', 'Security compliance', 'Cost optimization', 'Legacy system maintenance'],
      motivations: ['Operational efficiency', 'System reliability', 'Cost control', 'User satisfaction'],
      decisionFactors: ['Cost-effectiveness', 'Integration capabilities', 'Support quality', 'Implementation timeline'],
      personaType: 'Director of IT',
      companyContext: {
        industry: 'Manufacturing',
        size: '1800 employees',
        revenue: '$420M annually',
        challenges: ['Digital transformation', 'System modernization', 'Operational efficiency'],
        priorities: ['ERP integration', 'Cloud migration', 'Security enhancement']
      },
      personalizedApproach: {
        keyMessage: 'Streamline your manufacturing operations with integrated IT solutions that reduce costs and improve efficiency',
        valueProposition: 'Cut operational costs by 25% while improving system reliability and user satisfaction',
        approachStrategy: 'Focus on operational benefits, demonstrate cost savings, provide manufacturing case studies',
        bestContactTime: 'Monday-Friday, 8-10 AM CET',
        preferredChannel: 'Operational review or cost-benefit analysis'
      }
    },
    {
      id: '5',
      name: 'Michelle Rodriguez',
      title: 'Head of Digital Transformation',
      level: 'director',
      influence: 70,
      department: 'Digital Strategy',
      company: 'Retail Dynamics',
      location: 'Sydney, Australia',
      email: 'michelle.rodriguez@retaildyn.com',
      phone: '+61 2 9876 5432',
      linkedin: 'linkedin.com/in/michellerodriguez',
      experience: '8+ years in digital transformation',
      communicationPreference: 'Change Management & Business Impact',
      painPoints: ['Change resistance from teams', 'Process complexity', 'Technology integration', 'ROI measurement'],
      motivations: ['Business transformation', 'Process efficiency', 'Innovation adoption', 'Competitive advantage'],
      decisionFactors: ['Transformation impact', 'Change management support', 'Integration ease', 'Success metrics'],
      personaType: 'Head of Digital Transformation',
      companyContext: {
        industry: 'Retail',
        size: '1200 employees',
        revenue: '$350M annually',
        challenges: ['Omnichannel integration', 'Customer experience', 'Digital adoption'],
        priorities: ['Customer journey optimization', 'Digital platform integration', 'Data analytics']
      },
      personalizedApproach: {
        keyMessage: 'Accelerate your retail digital transformation with solutions designed for seamless customer experiences',
        valueProposition: 'Improve customer satisfaction by 35% while reducing operational complexity across all channels',
        approachStrategy: 'Focus on customer impact, demonstrate change management support, show retail success stories',
        bestContactTime: 'Tuesday-Thursday, 9-11 AM AEST',
        preferredChannel: 'Digital transformation workshop or customer experience demo'
      }
    },
    {
      id: '6',
      name: 'Robert Garcia',
      title: 'VP of Operations',
      level: 'director',
      influence: 65,
      department: 'Operations',
      company: 'Energy Solutions Ltd',
      location: 'Oslo, Norway',
      email: 'robert.garcia@energysol.com',
      phone: '+47 22 12 34 56',
      linkedin: 'linkedin.com/in/robertgarcia',
      experience: '12+ years in operations management',
      communicationPreference: 'Operational Excellence & Performance',
      painPoints: ['Process inefficiencies', 'Cost pressures', 'Quality control', 'Scalability challenges'],
      motivations: ['Operational excellence', 'Cost reduction', 'Quality improvement', 'Productivity gains'],
      decisionFactors: ['Operational impact', 'Cost savings potential', 'Implementation ease', 'Performance metrics'],
      personaType: 'VP of Operations',
      companyContext: {
        industry: 'Renewable Energy',
        size: '2800 employees',
        revenue: '$2.1B annually',
        challenges: ['Operational scaling', 'Sustainability goals', 'Cost optimization'],
        priorities: ['Process automation', 'Sustainability metrics', 'Operational efficiency']
      },
      personalizedApproach: {
        keyMessage: 'Optimize your energy operations with sustainable solutions that drive both performance and environmental goals',
        valueProposition: 'Achieve 20% operational efficiency gains while meeting sustainability targets and reducing costs',
        approachStrategy: 'Focus on operational metrics, demonstrate sustainability benefits, provide energy sector case studies',
        bestContactTime: 'Monday-Wednesday, 8-10 AM CET',
        preferredChannel: 'Operational efficiency review or sustainability workshop'
      }
    },
    {
      id: '7',
      name: 'Jessica Chen',
      title: 'Director of Product Management',
      level: 'director',
      influence: 60,
      department: 'Product',
      company: 'StartupHub Accelerator',
      location: 'Singapore',
      email: 'jessica.chen@startuphub.com',
      phone: '+65 6123 4567',
      linkedin: 'linkedin.com/in/jessicachen',
      experience: '8+ years in product management',
      communicationPreference: 'User-Centric & Market Impact',
      painPoints: ['Feature complexity', 'Market competition', 'User adoption', 'Development timelines'],
      motivations: ['Product success', 'User satisfaction', 'Market leadership', 'Innovation delivery'],
      decisionFactors: ['Product-market fit', 'User impact', 'Development efficiency', 'Market differentiation'],
      personaType: 'Director of Product Management',
      companyContext: {
        industry: 'Startup Acceleration',
        size: '85 employees',
        revenue: '$12M annually',
        challenges: ['Rapid growth', 'Product scalability', 'Market positioning'],
        priorities: ['Product innovation', 'User experience', 'Market expansion']
      },
      personalizedApproach: {
        keyMessage: 'Accelerate your product development with tools that enhance user experience and speed time-to-market',
        valueProposition: 'Reduce product development cycles by 40% while improving user satisfaction and market fit',
        approachStrategy: 'Focus on user impact, demonstrate product benefits, show startup success stories',
        bestContactTime: 'Monday-Friday, 9-11 AM SGT',
        preferredChannel: 'Product demo or user experience workshop'
      }
    },
    {
      id: '8',
      name: 'Christopher Brown',
      title: 'Head of Procurement',
      level: 'manager',
      influence: 55,
      department: 'Procurement',
      company: 'Financial Services Group',
      location: 'London, UK',
      email: 'christopher.brown@finservices.com',
      phone: '+44 20 7890 1234',
      linkedin: 'linkedin.com/in/christopherbrown',
      experience: '10+ years in procurement',
      communicationPreference: 'Cost Optimization & Risk Management',
      painPoints: ['Vendor evaluation complexity', 'Cost pressures', 'Compliance requirements', 'Supply chain risks'],
      motivations: ['Cost savings', 'Risk mitigation', 'Quality assurance', 'Process efficiency'],
      decisionFactors: ['Total cost of ownership', 'Vendor stability', 'Contract terms', 'Risk profile'],
      personaType: 'Head of Procurement',
      companyContext: {
        industry: 'Financial Services',
        size: '3200 employees',
        revenue: '$1.2B annually',
        challenges: ['Regulatory compliance', 'Cost management', 'Vendor risk'],
        priorities: ['Cost optimization', 'Compliance automation', 'Vendor consolidation']
      },
      personalizedApproach: {
        keyMessage: 'Optimize your procurement processes with solutions that reduce costs while ensuring full regulatory compliance',
        valueProposition: 'Achieve 15% cost savings while reducing procurement cycle time and ensuring regulatory compliance',
        approachStrategy: 'Focus on cost benefits, demonstrate compliance features, provide financial services case studies',
        bestContactTime: 'Tuesday-Thursday, 10 AM-12 PM GMT',
        preferredChannel: 'Cost-benefit analysis or compliance review'
      }
    },
    {
      id: '9',
      name: 'Mark Thompson',
      title: 'VP of Sales',
      level: 'director',
      influence: 50,
      department: 'Sales',
      company: 'EduTech University',
      location: 'Boston, MA',
      email: 'mark.thompson@edutech.edu',
      phone: '+1 (617) 555-9876',
      linkedin: 'linkedin.com/in/markthompson',
      experience: '12+ years in sales leadership',
      communicationPreference: 'Revenue Impact & Performance',
      painPoints: ['Sales efficiency', 'Lead quality', 'Customer acquisition costs', 'Revenue predictability'],
      motivations: ['Revenue growth', 'Sales performance', 'Customer success', 'Market expansion'],
      decisionFactors: ['Sales impact', 'ROI measurement', 'Adoption ease', 'Performance metrics'],
      personaType: 'VP of Sales',
      companyContext: {
        industry: 'Education Technology',
        size: '1500 employees',
        revenue: '$85M annually',
        challenges: ['Student acquisition', 'Revenue growth', 'Market competition'],
        priorities: ['Sales automation', 'Lead generation', 'Customer retention']
      },
      personalizedApproach: {
        keyMessage: 'Boost your educational sales performance with tools that improve lead quality and accelerate enrollment',
        valueProposition: 'Increase enrollment rates by 25% while reducing customer acquisition costs and improving student satisfaction',
        approachStrategy: 'Focus on revenue impact, demonstrate sales metrics, show education sector success stories',
        bestContactTime: 'Monday-Wednesday, 9-11 AM EST',
        preferredChannel: 'Sales performance review or ROI demonstration'
      }
    },
    {
      id: '10',
      name: 'Patricia Davis',
      title: 'Chief Information Officer',
      level: 'executive',
      influence: 90,
      department: 'Information Technology',
      company: 'City Government Services',
      location: 'Ottawa, Canada',
      email: 'patricia.davis@citygovt.ca',
      phone: '+1 (613) 555-2468',
      linkedin: 'linkedin.com/in/patriciadavis',
      experience: '15+ years in government IT',
      communicationPreference: 'Strategic IT & Public Service',
      painPoints: ['Legacy system modernization', 'Cybersecurity threats', 'Budget constraints', 'Citizen service delivery'],
      motivations: ['Public service improvement', 'Operational efficiency', 'Security enhancement', 'Cost optimization'],
      decisionFactors: ['Public benefit', 'Security standards', 'Budget efficiency', 'Implementation feasibility'],
      personaType: 'Chief Information Officer',
      companyContext: {
        industry: 'Government Services',
        size: '5000 employees',
        revenue: '$500M budget',
        challenges: ['Digital transformation', 'Citizen engagement', 'Security compliance'],
        priorities: ['Digital services', 'Cybersecurity', 'Operational efficiency']
      },
      personalizedApproach: {
        keyMessage: 'Transform citizen services with secure, efficient digital solutions that improve public engagement',
        valueProposition: 'Enhance citizen satisfaction by 40% while reducing operational costs and ensuring government-grade security',
        approachStrategy: 'Focus on public benefit, demonstrate security compliance, show government success stories',
        bestContactTime: 'Tuesday-Thursday, 9-11 AM EST',
        preferredChannel: 'Government briefing or security compliance review'
      }
    }
  ];

  // Get unique persona types for filter
  const personaTypes = [...new Set(decisionMakers.map(dm => dm.personaType))];

  const filteredDecisionMakers = decisionMakers.filter(dm => {
    return !filterPersona || dm.personaType === filterPersona;
  });

  const calculateMatchScore = (decisionMaker: DecisionMaker): number => {
    // Calculate match based on level, influence, and pain points alignment
    const levelMatch = decisionMaker.level === 'executive' ? 100 : decisionMaker.level === 'director' ? 90 : 75;
    const influenceMatch = decisionMaker.influence;
    const painPointMatch = decisionMaker.painPoints.length > 2 ? 95 : 80;
    return Math.round((levelMatch + influenceMatch + painPointMatch) / 3);
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

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'executive':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'director':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'manager':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const saveDecisionMakers = () => {
    updateDecisionMakers(decisionMakers);
  };

  const handleProceedToInsights = () => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'insights' }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h3 className="text-lg font-semibold text-gray-900">Loading decision makers...</h3>
          <p className="text-gray-600">Discovering key contacts from your searched businesses</p>
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
          <h3 className="text-2xl font-semibold text-gray-900 mb-4">No Decision Makers Yet</h3>
          <p className="text-gray-600 mb-8">
            Start a search to discover decision makers from businesses that match your product or service.
          </p>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('navigate', { detail: 'search' }))}
            className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Search className="w-5 h-5" />
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
            {state.selectedDecisionMakerPersonas && state.selectedDecisionMakerPersonas.length === 1 
              ? `Decision Makers: ${state.selectedDecisionMakerPersonas[0].title}`
              : `Decision Makers for "${state.searchData?.productService}"`
            }
          </h1>
          <p className="text-gray-600 mt-2">
            {state.selectedDecisionMakerPersonas && state.selectedDecisionMakerPersonas.length === 1 
              ? `Individual decision makers matching the ${state.selectedDecisionMakerPersonas[0].title} persona`
              : 'Individual decision maker profiles with personalized approach strategies'
            }
          </p>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={saveDecisionMakers}
            className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Save className="w-5 h-5" />
            <span>Save Mapping</span>
          </button>
          <button
            onClick={handleProceedToInsights}
            className="flex items-center space-x-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <span>Next: Market Insights</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Enhanced Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center space-x-4">
          <Filter className="w-5 h-5 text-gray-400" />
          <div className="flex space-x-4 flex-1">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Decision Maker Persona</label>
              <select
                value={filterPersona}
                onChange={(e) => setFilterPersona(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-64"
              >
                <option value="">All Personas</option>
                {personaTypes.map(persona => (
                  <option key={persona} value={persona}>{persona}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="text-sm text-gray-500">
            {filteredDecisionMakers.length} decision makers found
            {state.selectedDecisionMakerPersonas && state.selectedDecisionMakerPersonas.length === 1 && (
              <div className="text-blue-600 font-medium">
                Filtered by: {state.selectedDecisionMakerPersonas[0].title}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <h2 className="text-xl font-semibold text-gray-900">Decision Makers</h2>
          
          {filteredDecisionMakers
            .sort((a, b) => b.influence - a.influence)
            .map((dm, index) => {
              const matchScore = calculateMatchScore(dm);
              return (
              <div
                key={dm.id}
                onClick={() => setSelectedEmployee(dm)}
                className={`bg-white rounded-xl shadow-sm border-2 p-6 cursor-pointer transition-all hover:shadow-md ${
                  selectedEmployee?.id === dm.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start space-x-4">
                    <div className="flex-shrink-0">
                      {getLevelIcon(dm.level)}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 text-lg">{dm.name}</h3>
                      <p className="text-gray-600 mb-1">{dm.title}</p>
                      <p className="text-sm text-gray-500 mb-2">{dm.company} • {dm.location}</p>
                      <div className="flex items-center space-x-2 mb-2">
                        <Target className="w-4 h-4 text-blue-600" />
                        <span className="text-sm text-blue-600 font-medium">{dm.personaType}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`px-3 py-1 rounded-full text-sm font-medium mb-2 ${
                      matchScore >= 90 ? 'bg-green-100 text-green-800' :
                      matchScore >= 80 ? 'bg-blue-100 text-blue-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {matchScore}% Match
                    </div>
                    {dm.enrichmentStatus === 'pending' && (
                      <div className="px-2 py-1 rounded-full text-xs font-medium mb-2 bg-orange-100 text-orange-800">
                        Details Loading...
                      </div>
                    )}
                    {dm.enrichmentStatus === 'done' && (
                      <div className="px-2 py-1 rounded-full text-xs font-medium mb-2 bg-green-100 text-green-800">
                        ✓ Enriched
                      </div>
                    )}
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      {dm.level}
                    </div>
                    <div className="w-20 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${dm.influence}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{dm.influence}% influence</div>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                  <div className="flex items-center space-x-2 text-gray-600">
                    <Building className="w-4 h-4" />
                    <span>{dm.department}</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-600">
                    <Briefcase className="w-4 h-4" />
                    <span>{dm.experience}</span>
                  </div>
                </div>
                
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Communication Preference</h4>
                  <p className="text-sm text-gray-600">{dm.communicationPreference}</p>
                </div>
                
                <div className="flex flex-wrap gap-2">
                  {dm.painPoints.slice(0, 2).map((point, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full"
                    >
                      {point}
                    </span>
                  ))}
                  {dm.painPoints.length > 2 && (
                    <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                      +{dm.painPoints.length - 2} more
                    </span>
                  )}
                </div>
              </div>
              );
            })}
        </div>

        {/* Detailed Individual Persona */}
        <div className="sticky top-8">
          {selectedEmployee ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
              {/* Header */}
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start space-x-4">
                    <div className="w-16 h-16 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-xl">
                      {selectedEmployee.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900">{selectedEmployee.name}</h2>
                      <p className="text-gray-600 mt-1">{selectedEmployee.title}</p>
                      <p className="text-sm text-gray-500">{selectedEmployee.company}</p>
                      <div className="flex items-center space-x-2 mt-2">
                        <Target className="w-4 h-4 text-blue-600" />
                        <span className="text-sm text-blue-600 font-medium">{selectedEmployee.personaType}</span>
                      </div>
                    </div>
                  </div>
                  <div className={`px-4 py-2 rounded-full text-sm font-medium ${
                    calculateMatchScore(selectedEmployee) >= 90 ? 'bg-green-100 text-green-800' :
                    calculateMatchScore(selectedEmployee) >= 80 ? 'bg-blue-100 text-blue-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {calculateMatchScore(selectedEmployee)}% Match
                  </div>
                </div>

                {/* Contact Information */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="flex items-center space-x-2 text-gray-600">
                    <Mail className="w-4 h-4" />
                    <span className="truncate">{selectedEmployee.email}</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-600">
                    <Phone className="w-4 h-4" />
                    <span>{selectedEmployee.phone}</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-600">
                    <MapPin className="w-4 h-4" />
                    <span>{selectedEmployee.location}</span>
                  </div>
                </div>
              </div>

              {/* Detailed Content */}
              <div className="p-6 space-y-6">
                {/* Company Context */}
                <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                  <h3 className="font-semibold text-blue-900 mb-3">Company Context</h3>
                  {selectedEmployee.business && (
                    <div className="mb-4 p-3 bg-white rounded-lg border border-blue-200">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium text-blue-900">{selectedEmployee.business.name}</h4>
                        {selectedEmployee.business.rating && (
                          <div className="flex items-center space-x-1">
                            <span className="text-sm text-yellow-600">★</span>
                            <span className="text-sm text-blue-700">{selectedEmployee.business.rating}</span>
                          </div>
                        )}
                      </div>
                      <p className="text-sm text-blue-700 mb-2">{selectedEmployee.business.description}</p>
                      <div className="flex items-center space-x-4 text-xs text-blue-600">
                        {selectedEmployee.business.city && (
                          <span>{selectedEmployee.business.city}, {selectedEmployee.business.country}</span>
                        )}
                        {selectedEmployee.business.website && (
                          <a href={selectedEmployee.business.website} target="_blank" rel="noopener noreferrer" 
                             className="text-blue-600 hover:text-blue-800 underline">
                            Website
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                    <div>
                      <span className="text-blue-700 font-medium">Industry:</span>
                      <p className="text-blue-900">{selectedEmployee.business?.industry || selectedEmployee.companyContext?.industry || 'Not specified'}</p>
                    </div>
                    <div>
                      <span className="text-blue-700 font-medium">Size:</span>
                      <p className="text-blue-900">{selectedEmployee.business?.size || selectedEmployee.companyContext?.size || 'Not specified'}</p>
                    </div>
                    <div>
                      <span className="text-blue-700 font-medium">Revenue:</span>
                      <p className="text-blue-900">{selectedEmployee.business?.revenue || selectedEmployee.companyContext?.revenue || 'Not specified'}</p>
                    </div>
                    <div>
                      <span className="text-blue-700 font-medium">Experience:</span>
                      <p className="text-blue-900">{selectedEmployee.experience}</p>
                    </div>
                  </div>
                  <div className="mb-3">
                    <span className="text-blue-700 font-medium">Company Challenges:</span>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {(selectedEmployee.companyContext?.challenges || []).map((challenge, idx) => (
                        <span key={idx} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                          {challenge}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-blue-700 font-medium">Company Priorities:</span>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {(selectedEmployee.companyContext?.priorities || []).map((priority, idx) => (
                        <span key={idx} className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                          {priority}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Personal Pain Points & Motivations */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3">Pain Points</h4>
                    <div className="space-y-2">
                      {(selectedEmployee.painPoints || []).map((point, index) => (
                        <div key={index} className="flex items-start space-x-2">
                          <div className="w-2 h-2 bg-red-500 rounded-full mt-2 flex-shrink-0"></div>
                          <span className="text-gray-700 text-sm">{point}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3">Motivations</h4>
                    <div className="space-y-2">
                      {(selectedEmployee.motivations || []).map((motivation, index) => (
                        <div key={index} className="flex items-start space-x-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
                          <span className="text-gray-700 text-sm">{motivation}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Decision Factors */}
                <div>
                  <h4 className="font-semibold text-gray-900 mb-3">Key Decision Factors</h4>
                  <div className="flex flex-wrap gap-2">
                    {(selectedEmployee.decisionFactors || []).map((factor, index) => (
                      <span key={index} className="px-3 py-1 bg-purple-100 text-purple-800 text-sm rounded-full">
                        {factor}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Personalized Approach Strategy */}
                <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-xl p-4 border border-green-200">
                  <h3 className="font-semibold text-gray-900 mb-4 flex items-center space-x-2">
                    <MessageSquare className="w-5 h-5 text-green-600" />
                    <span>Personalized Approach Strategy</span>
                  </h3>
                  
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium text-gray-800 mb-2">Key Message</h4>
                      <p className="text-gray-700 text-sm bg-white p-3 rounded-lg border">
                        {selectedEmployee.personalizedApproach.keyMessage}
                      </p>
                    </div>

                    <div>
                      <h4 className="font-medium text-gray-800 mb-2">Value Proposition</h4>
                      <p className="text-gray-700 text-sm bg-white p-3 rounded-lg border">
                        {selectedEmployee.personalizedApproach.valueProposition}
                      </p>
                    </div>

                    <div>
                      <h4 className="font-medium text-gray-800 mb-2">Approach Strategy</h4>
                      <p className="text-gray-700 text-sm bg-white p-3 rounded-lg border">
                        {selectedEmployee.personalizedApproach.approachStrategy}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <h4 className="font-medium text-gray-800 mb-2">Best Contact Time</h4>
                        <div className="flex items-center space-x-2 text-sm text-gray-600">
                          <Calendar className="w-4 h-4" />
                          <span>{selectedEmployee.personalizedApproach.bestContactTime}</span>
                        </div>
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-800 mb-2">Preferred Channel</h4>
                        <div className="flex items-center space-x-2 text-sm text-gray-600">
                          <MessageSquare className="w-4 h-4" />
                          <span>{selectedEmployee.personalizedApproach.preferredChannel}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Contact Actions */}
                <div className="flex space-x-3">
                  <button className="flex-1 flex items-center justify-center space-x-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                    <Mail className="w-4 h-4" />
                    <span>Send Email</span>
                  </button>
                  <button className="flex-1 flex items-center justify-center space-x-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                    <Linkedin className="w-4 h-4" />
                    <span>Connect on LinkedIn</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
              <UserCheck className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Decision Maker</h3>
              <p className="text-gray-600">
                Choose a decision maker from the list to view their detailed persona and personalized approach strategy.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}