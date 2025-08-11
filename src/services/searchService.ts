import { supabase } from '../lib/supabase';
import type { UserSearch, BusinessPersona, Business, DecisionMakerPersona, DecisionMaker, MarketInsight } from '../lib/supabase';
import { DEMO_USER_ID } from '../constants/demo';

export class SearchService {
  private static readonly functionsBase: string = '/.netlify/functions';
  // Lightweight in-memory caches to avoid spamming functions on dashboard load
  private static searchesCache: { userId: string; ts: number; data: any[] } | null = null;
  private static progressCache = new Map<string, { ts: number; data: any }>();
  private static readonly TTL_MS = 5000; // 5s cache TTL for dashboard views
  private static backfillInFlight = new Set<string>();

  // Create a new search and trigger agent orchestration
  static async createSearch(userId: string, searchData: {
    search_type: 'customer' | 'supplier';
    product_service: string;
    industries: string[];
    countries: string[];
  }): Promise<UserSearch> {
    const { data, error } = await supabase
      .from('user_searches')
      .insert({
        user_id: userId,
        status: 'in_progress', // Explicitly set valid status
        ...searchData
      })
      .select()
      .single();

    if (error) throw error;

    // For real users (not demo), trigger agent orchestration
    if (userId !== DEMO_USER_ID) {
      try {
        // Call the orchestrator API to start agent processing
        const response = await fetch(`${this.functionsBase}/orchestrator-start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            search_id: data.id,
            user_id: userId
          })
        });

        if (!response.ok) {
          console.error('Failed to trigger agent orchestration:', response.status);
        } else {
          const result = await response.json();
          console.log(`Background agent orchestration started for search ${data.id}:`, result);
        }
      } catch (error) {
        console.error('Error triggering agent orchestration:', error);
        // Don't fail the search creation if orchestration fails
      }
    }

    // Invalidate user searches cache so the new search appears immediately
    this.searchesCache = null;
    return data;
  }

  // Get user's searches (with demo mode support)
  static async getUserSearches(userId: string, isDemoMode: boolean = false): Promise<UserSearch[]> {
    // If in demo mode, show demo data instead of user data
    const targetUserId = isDemoMode ? DEMO_USER_ID : userId;
    
    try {
      // Serve from cache if recent
      if (this.searchesCache && this.searchesCache.userId === targetUserId && Date.now() - this.searchesCache.ts < this.TTL_MS) {
        return this.searchesCache.data as any;
      }

       let searches: any[] = [];
       try {
         const proxyResp = await fetch(`${this.functionsBase}/user-data-proxy?table=user_searches&user_id=${targetUserId}`, {
          method: 'GET', headers: { 'Accept': 'application/json' }
        });
        if (proxyResp.ok) {
          searches = await proxyResp.json();
        } else {
          const { data, error } = await supabase
            .from('user_searches')
            .select('*')
            .eq('user_id', targetUserId)
            .order('created_at', { ascending: false });
          if (error) throw error;
          searches = Array.isArray(data) ? data : [];
        }
      } catch {
        const { data } = await supabase
          .from('user_searches')
          .select('*')
          .eq('user_id', targetUserId)
          .order('created_at', { ascending: false });
        searches = Array.isArray(data) ? data : [];
      }

      // Normalize progress and totals
      const normalized = searches.map((s: any) => ({
        ...s,
        progress: { phase: s.phase, progress_pct: s.progress_pct, status: s.status },
        totals: s.totals || { business_personas:0, dm_personas:0, businesses:0, decision_makers:0, market_insights:0 },
        timestamp: s.created_at
      }));

      // Fire-and-forget: backfill totals for any search missing counts
      void this.backfillMissingTotals(normalized);

      this.searchesCache = { userId: targetUserId, ts: Date.now(), data: normalized };
      return normalized as any;
    } catch (error: any) {
      // Fallback to proxy if direct Supabase call fails (CORS issues)
      if (error.message?.includes('Load failed') || error.message?.includes('access control')) {
        console.log('CORS issue detected, falling back to proxy...');
        try {
          const response = await fetch(`${this.functionsBase}/user-data-proxy?table=user_searches&user_id=${targetUserId}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            }
          });
          if (!response.ok) throw new Error(`Proxy request failed: ${response.status}`);
          return await response.json();
        } catch {
          console.log('Proxy also failed, returning empty array for now...');
          return []; // Return empty array as final fallback
        }
      }
      throw error;
    }
  }

  // Backfill totals for searches that have zero/empty totals, without blocking UI
  private static async backfillMissingTotals(searches: any[]): Promise<void> {
    const candidates = searches.filter(s => {
      const t = s.totals || {};
      const missing = (t.business_personas ?? 0) + (t.dm_personas ?? 0) + (t.businesses ?? 0) + (t.decision_makers ?? 0) + (t.market_insights ?? 0);
      return !this.backfillInFlight.has(s.id) && missing === 0;
    });
    if (candidates.length === 0) return;

    const limit = 3; // limit concurrency
    const queue = [...candidates];
    const runOne = async () => {
      const s = queue.shift();
      if (!s) return;
      this.backfillInFlight.add(s.id);
      try {
        // Use proxy-aware getters to avoid CORS/RLS issues in browsers
        const [bp, dmp, b, dm, mi] = await Promise.all([
          this.getBusinessPersonas(s.id),
          this.getDecisionMakerPersonas(s.id),
          this.getBusinesses(s.id),
          this.getDecisionMakers(s.id),
          this.getMarketInsights(s.id)
        ]);
        const totals = {
          business_personas: Array.isArray(bp) ? bp.length : 0,
          dm_personas: Array.isArray(dmp) ? dmp.length : 0,
          businesses: Array.isArray(b) ? b.length : 0,
          decision_makers: Array.isArray(dm) ? dm.length : 0,
          market_insights: mi ? 1 : 0,
        } as any;
        // Update DB, but do not block
        void supabase.from('user_searches').update({ totals, updated_at: new Date().toISOString() }).eq('id', s.id);
        // Also update in-memory cache copy if present
        if (this.searchesCache) {
          this.searchesCache.data = this.searchesCache.data.map(x => x.id === s.id ? { ...x, totals } : x);
        }
      } catch {
        // ignore errors; this is best-effort
      } finally {
        this.backfillInFlight.delete(s.id);
        await runOne();
      }
    };

    await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, () => runOne()));
  }

  // Count qualified leads for a user: decision makers with at least one contact handle
  static async countQualifiedLeads(userId: string): Promise<number> {
    // Prefer proxy to avoid CORS/RLS issues in browsers (Safari)
    const proxyUrl = `/.netlify/functions/user-data-proxy?table=decision_makers&user_id=${userId}`;
    try {
      const resp = await fetch(proxyUrl, { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (resp.ok) {
        const data = await resp.json();
        const arr = Array.isArray(data) ? data : [];
        return arr.filter((dm: any) => {
          const hasLinkedin = typeof dm.linkedin === 'string' && dm.linkedin.trim() !== '';
          const hasEmail = typeof dm.email === 'string' && dm.email.trim() !== '';
          const hasPhone = typeof dm.phone === 'string' && dm.phone.trim() !== '';
          return hasLinkedin || hasEmail || hasPhone;
        }).length;
      }
      // Fallback to direct Supabase if proxy unavailable
      const { data, error } = await supabase
        .from('decision_makers')
        .select('id, linkedin, email, phone')
        .eq('user_id', userId);
      if (error) throw error;
      const arr = Array.isArray(data) ? data : [];
      return arr.filter(dm => {
        const hasLinkedin = typeof (dm as any).linkedin === 'string' && (dm as any).linkedin.trim() !== '';
        const hasEmail = typeof (dm as any).email === 'string' && (dm as any).email.trim() !== '';
        const hasPhone = typeof (dm as any).phone === 'string' && (dm as any).phone.trim() !== '';
        return hasLinkedin || hasEmail || hasPhone;
      }).length;
    } catch (error) {
      console.error('Failed counting qualified leads:', error);
      return 0;
    }
  }

  // Update search status
  static async updateSearchStatus(searchId: string, status: 'in_progress' | 'completed'): Promise<void> {
    const { error } = await supabase
      .from('user_searches')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', searchId);

    if (error) throw error;
  }

  // Get business personas for a search (agents generate them automatically)
  static async generateBusinessPersonas(searchId: string, userId: string, _searchData: any): Promise<BusinessPersona[]> {
    // For demo user, return pre-populated data
    if (userId === DEMO_USER_ID) {
      return await this.getBusinessPersonas(searchId);
    }
    
    // For real users, agents have already generated the data via orchestration
    // Just return what's in the database (created by BusinessPersonaAgent)
    return await this.getBusinessPersonas(searchId);
  }

  // Get business personas for a search
  static async getBusinessPersonas(searchId: string): Promise<BusinessPersona[]> {
    // Proxy-first to avoid CORS/RLS issues in browsers
    try {
      const response = await fetch(`${this.functionsBase}/user-data-proxy?table=business_personas&search_id=${searchId}`, { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (response.ok) {
        const arr = await response.json();
        const list = Array.isArray(arr) ? arr : [];
        return list as any;
      }
    } catch {}
    // Fallback to direct anon Supabase if proxy unavailable
    try {
      const { data } = await supabase
        .from('business_personas')
        .select('*')
        .eq('search_id', searchId)
        .order('rank');
      return Array.isArray(data) ? (data as any) : [];
    } catch {
      return [];
    }
  }

  // Check if user should see demo data
  static async shouldShowDemoData(userId: string): Promise<boolean> {
    if (userId === DEMO_USER_ID) return true;
    
    const { data: profile } = await supabase
      .from('app_users')
      .select('is_demo_user')
      .eq('id', userId)
      .single();
    
    return profile?.is_demo_user || false;
  }

  // Get businesses for a search (agents generate them automatically via Serper Places)
  static async generateBusinesses(searchId: string, userId: string, personas: BusinessPersona[]): Promise<Business[]> {
    // For demo user, generate mock data if none exists
    if (userId === DEMO_USER_ID) {
      const existing = await this.getBusinesses(searchId);
      if (existing.length > 0) return existing;
      
      const mockBusinesses = this.generateMockBusinesses(personas);
      const businessesToInsert = mockBusinesses.map(business => ({
        search_id: searchId,
        user_id: userId,
        persona_id: business.persona_id,
        name: business.name,
        industry: business.industry,
        country: business.country,
        city: business.city,
        size: business.size,
        revenue: business.revenue,
        description: business.description,
        match_score: business.match_score,
        relevant_departments: business.relevant_departments,
        key_products: business.key_products,
        recent_activity: business.recent_activity,
        persona_type: business.persona_type
      }));

      const { data, error } = await supabase
        .from('businesses')
        .insert(businessesToInsert)
        .select();

      if (error) throw error;
      return data;
    }
    
    // For real users, agents have already generated the data via BusinessDiscoveryAgent
    // Just return what's in the database (created by Serper Places API)
    return await this.getBusinesses(searchId);
  }

  // Get businesses for a search
  static async getBusinesses(searchId: string): Promise<Business[]> {
    // Proxy-first
    try {
      const response = await fetch(`${this.functionsBase}/user-data-proxy?table=businesses&search_id=${searchId}`, { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (response.ok) {
        const arr = await response.json();
        const list = Array.isArray(arr) ? arr : [];
        return list as any;
      } else if (response.status === 404) {
        // Treat 404 (no rows) as empty array to avoid blocking UI
        return [];
      }
    } catch {}
    // Fallback to direct anon Supabase
    try {
      const { data } = await supabase
        .from('businesses')
        .select('*')
        .eq('search_id', searchId)
        .order('match_score', { ascending: false });
      return Array.isArray(data) ? (data as any) : [];
    } catch {
      return [];
    }
  }

  // Get decision maker personas for a search (agents generate them automatically)
  static async generateDecisionMakerPersonas(searchId: string, userId: string, _searchData: any): Promise<DecisionMakerPersona[]> {
    // For demo user, generate mock data if none exists
    if (userId === DEMO_USER_ID) {
      const existing = await this.getDecisionMakerPersonas(searchId);
      if (existing.length > 0) return existing;
      
      const mockPersonas = this.generateMockDecisionMakerPersonas(searchData);
      const personasToInsert = mockPersonas.map((persona, index) => ({
        search_id: searchId,
        user_id: userId,
        title: persona.title,
        rank: index + 1,
        match_score: persona.match_score,
        demographics: persona.demographics,
        characteristics: persona.characteristics,
        behaviors: persona.behaviors,
        market_potential: persona.market_potential
      }));

      const { data, error } = await supabase
        .from('decision_maker_personas')
        .insert(personasToInsert)
        .select();

      if (error) throw error;
      return data;
    }
    
    // For real users, agents have already generated the data via DMPersonaAgent
    // Just return what's in the database
    return await this.getDecisionMakerPersonas(searchId);
  }

  // Get decision maker personas for a search
  static async getDecisionMakerPersonas(searchId: string): Promise<DecisionMakerPersona[]> {
    // Proxy-first
    try {
      const response = await fetch(`${this.functionsBase}/user-data-proxy?table=decision_maker_personas&search_id=${searchId}`, { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (response.ok) {
        const arr = await response.json();
        const list = Array.isArray(arr) ? arr : [];
        return list as any;
      }
    } catch {}
    // Fallback to direct anon Supabase
    try {
      const { data } = await supabase
        .from('decision_maker_personas')
        .select('*')
        .eq('search_id', searchId)
        .order('rank');
      return Array.isArray(data) ? (data as any) : [];
    } catch {
      return [];
    }
  }

  // Get decision makers for a search (agents generate them automatically via LinkedIn)
  static async generateDecisionMakers(searchId: string, userId: string, personas: DecisionMakerPersona[]): Promise<DecisionMaker[]> {
    // For demo user, generate mock data if none exists
    if (userId === DEMO_USER_ID) {
      const existing = await this.getDecisionMakers(searchId);
      if (existing.length > 0) return existing;
      
      const mockDecisionMakers = this.generateMockDecisionMakers(personas);
      const decisionMakersToInsert = mockDecisionMakers.map(dm => ({
        search_id: searchId,
        user_id: userId,
        persona_id: dm.persona_id,
        name: dm.name,
        title: dm.title,
        level: dm.level,
        influence: dm.influence,
        department: dm.department,
        company: dm.company,
        location: dm.location,
        email: dm.email,
        phone: dm.phone,
        linkedin: dm.linkedin,
        experience: dm.experience,
        communication_preference: dm.communication_preference,
        pain_points: dm.pain_points,
        motivations: dm.motivations,
        decision_factors: dm.decision_factors,
        persona_type: dm.persona_type,
        company_context: dm.company_context,
        personalized_approach: dm.personalized_approach
      }));

      const { data, error } = await supabase
        .from('decision_makers')
        .insert(decisionMakersToInsert)
        .select();

      if (error) throw error;
      return data;
    }
    
    // For real users, agents have already generated the data via DMDiscoveryAgent + LinkedIn search
    // Just return what's in the database (real decision makers from LinkedIn)
    return await this.getDecisionMakers(searchId);
  }

  // Get decision makers for a search with linked business context
  static async getDecisionMakers(searchId: string): Promise<DecisionMaker[]> {
    // Proxy-first
    try {
      const response = await fetch(`${this.functionsBase}/user-data-proxy?table=decision_makers&search_id=${searchId}`, { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (response.ok) {
        const arr = await response.json();
        const list = Array.isArray(arr) ? arr : [];
        return list as any;
      }
    } catch {}
    // Fallback to direct anon Supabase
    try {
      const { data } = await supabase
        .from('decision_makers')
        .select(`
        *,
        business:business_id (
          id,
          name,
          industry,
          country,
          city,
          size,
          revenue,
          description,
          rating,
          address,
          phone,
          website
        )
      `)
        .eq('search_id', searchId)
        .order('influence', { ascending: false });
      return Array.isArray(data) ? (data as any) : [];
    } catch {
      return [];
    }
  }

  // Get market insights for a search (agents generate them automatically via Gemini)
  static async generateMarketInsights(searchId: string, userId: string, _searchData: any): Promise<MarketInsight> {
    // For demo user, generate mock data if none exists
    if (userId === DEMO_USER_ID) {
      const existing = await this.getMarketInsights(searchId);
      if (existing) return existing;
      
      const mockInsights = this.generateMockMarketInsights(searchData);
      const { data, error } = await supabase
        .from('market_insights')
        .insert({
          search_id: searchId,
          user_id: userId,
          tam_data: mockInsights.tam_data,
          sam_data: mockInsights.sam_data,
          som_data: mockInsights.som_data,
          competitor_data: mockInsights.competitor_data,
          trends: mockInsights.trends,
          opportunities: mockInsights.opportunities
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    }
    
    // For real users, agents have already generated the data via MarketResearchAgent + Gemini
    // Just return what's in the database (comprehensive market analysis)
    const existing = await this.getMarketInsights(searchId);
    if (!existing) {
      throw new Error('Market insights not found - agent orchestration may not be complete');
    }
    return existing;
  }

  // Get market insights for a search
  static async getMarketInsights(searchId: string): Promise<MarketInsight | null> {
    // Proxy-first
    try {
      const response = await fetch(`${this.functionsBase}/user-data-proxy?table=market_insights&search_id=${searchId}`, { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (response.ok) {
        const arr = await response.json();
        return (Array.isArray(arr) && arr.length > 0) ? (arr[0] as any) : null;
      }
    } catch {}
    // Fallback to anon Supabase
    try {
      const { data } = await supabase
        .from('market_insights')
        .select('*')
        .eq('search_id', searchId)
        .limit(1);
      return (Array.isArray(data) && data.length > 0) ? (data[0] as any) : null;
    } catch {
      return null;
    }
  }

  // Mock data generation methods (these would be replaced with actual AI generation)
  private static generateMockBusinessPersonas(_searchData: any): any[] {
    // Generate personas based on search data
    const basePersonas = [
      {
         title: `Enterprise Technology Leader`,
        match_score: 95,
        demographics: {
           industry: 'Technology',
           companySize: '1000-5000 employees',
           geography: 'Global',
          revenue: '$100M-500M'
        },
        characteristics: {
          painPoints: ['Digital transformation', 'Scalability challenges', 'Cost optimization'],
          motivations: ['Innovation leadership', 'Competitive advantage', 'Operational efficiency'],
          challenges: ['Budget constraints', 'Change management', 'Technical complexity']
        },
        behaviors: {
          decisionMaking: 'Committee-based with 6-9 month evaluation',
          buyingProcess: 'Strategic evaluation with multiple stakeholders',
          preferredChannels: ['Direct sales', 'Industry conferences', 'Peer recommendations']
        },
        marketPotential: {
          totalCompanies: 2500,
          avgDealSize: '$850K',
          conversionRate: '12%'
        },
        locations: [
           { country: 'United States', cities: ['New York', 'San Francisco'], companies: 1200 }
        ]
      }
    ];

    return basePersonas;
  }

  private static generateMockBusinesses(personas: BusinessPersona[]): any[] {
    return personas.flatMap(persona => [
      {
        persona_id: persona.id,
        name: `${persona.demographics.industry} Solutions Corp`,
        industry: persona.demographics.industry,
        country: persona.locations[0]?.country || 'United States',
        city: persona.locations[0]?.cities[0] || 'New York',
        size: persona.demographics.companySize,
        revenue: persona.demographics.revenue,
        description: `Leading ${persona.demographics.industry.toLowerCase()} company`,
        match_score: persona.match_score,
        relevant_departments: ['Technology', 'Operations', 'Strategy'],
        key_products: ['Enterprise Software', 'Digital Solutions'],
        recent_activity: ['Launched new platform', 'Expanded operations'],
        persona_type: persona.title
      }
    ]);
  }

  private static generateMockDecisionMakerPersonas(_searchData: any): any[] {
    return [
      {
        title: 'Chief Technology Officer',
        match_score: 95,
        demographics: {
          level: 'C-Level Executive',
          department: 'Technology',
          experience: '15+ years',
          geography: searchData.countries.join(', ') || 'Global'
        },
        characteristics: {
          responsibilities: ['Technology strategy', 'Digital transformation', 'Budget allocation'],
          painPoints: ['Legacy modernization', 'Cybersecurity', 'Talent acquisition'],
          motivations: ['Innovation leadership', 'Competitive advantage', 'Efficiency'],
          decisionFactors: ['Strategic alignment', 'Scalability', 'Security']
        },
        behaviors: {
          decisionMaking: 'Strategic, data-driven',
          communicationStyle: 'High-level strategic discussions',
          buyingProcess: 'Committee-based with 6-12 month cycles',
          preferredChannels: ['Executive briefings', 'Industry conferences']
        },
        market_potential: {
          totalDecisionMakers: 2500,
          avgInfluence: '95%',
          conversionRate: '8%'
        }
      }
    ];
  }

  private static generateMockDecisionMakers(personas: DecisionMakerPersona[]): any[] {
    return personas.flatMap(persona => [
      {
        persona_id: persona.id,
        name: 'John Smith',
        title: persona.title,
        level: 'executive' as const,
        influence: 95,
        department: persona.demographics.department,
        company: 'TechCorp Solutions',
        location: 'San Francisco, CA',
        email: 'john.smith@techcorp.com',
        phone: '+1 (555) 123-4567',
        linkedin: 'linkedin.com/in/johnsmith',
        experience: persona.demographics.experience,
        communication_preference: persona.behaviors.communicationStyle,
        pain_points: persona.characteristics.painPoints,
        motivations: persona.characteristics.motivations,
        decision_factors: persona.characteristics.decisionFactors,
        persona_type: persona.title,
        company_context: {
          industry: 'Technology',
          size: '2500 employees',
          revenue: '$250M',
          challenges: ['Digital transformation', 'Scaling'],
          priorities: ['Innovation', 'Efficiency']
        },
        personalized_approach: {
          keyMessage: 'Transform your technology strategy with proven solutions',
          valueProposition: 'Reduce costs by 30% while improving efficiency',
          approachStrategy: 'Lead with strategic vision and ROI',
          bestContactTime: 'Tuesday-Thursday, 9-11 AM',
          preferredChannel: 'Executive briefing'
        }
      }
    ]);
  }

  private static generateMockMarketInsights(_searchData: any): any {
    return {
      tam_data: { value: '$2.4B', growth: '+12%', description: 'Total Addressable Market' },
      sam_data: { value: '$850M', growth: '+18%', description: 'Serviceable Addressable Market' },
      som_data: { value: '$125M', growth: '+24%', description: 'Serviceable Obtainable Market' },
      competitor_data: [
        { name: 'Competitor A', marketShare: 35, revenue: '$420M', growth: '+8%' },
        { name: 'Competitor B', marketShare: 28, revenue: '$336M', growth: '+12%' }
      ],
      trends: [
        { trend: 'AI-Powered Solutions', impact: 'High', growth: '+45%', description: 'Growing AI adoption' },
        { trend: 'Remote Work Tools', impact: 'Medium', growth: '+32%', description: 'Distributed teams' }
      ],
      opportunities: {
        segments: [
          { name: 'Enterprise', opportunity: '$450M' },
          { name: 'Mid-market', opportunity: '$280M' }
        ],
        geographic: [
          { region: 'Europe', potential: '$180M' },
          { region: 'Asia-Pacific', potential: '$220M' }
        ]
      }
    };
  }
}