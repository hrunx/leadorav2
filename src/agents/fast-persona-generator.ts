import { callOpenAIChatJSON, callGeminiText, callDeepseekChatJSON } from './clients';
import logger from '../lib/logger';
import { insertBusinessPersonas, insertDMPersonas, insertMarketInsights, updateSearchProgress } from '../tools/db.write';

// Fast Business Persona Generation (bypasses @openai/agents SDK)
export async function generateBusinessPersonasFast(searchData: {
  id: string;
  user_id: string;
  product_service: string;
  industries: string[];
  countries: string[];
  search_type: 'customer' | 'supplier';
}) {
  logger.info('⚡ Fast Business Persona Generation', { search_id: searchData.id });

  const industry = (searchData.industries && searchData.industries[0]) || 'General';
  const country = (searchData.countries && searchData.countries[0]) || 'United States';

  const prompt = `Create exactly 3 business personas (company archetypes) for ${searchData.product_service} ${searchData.search_type}s in ${country} within ${industry}. JSON only with key personas.`;

  function deterministicPersonas() {
    const base = (
      searchData.search_type === 'customer'
        ? [
            { title: `${industry} SMB Adopters`, size: 'Small (10-50)', revenue: '$1M-$10M', deal: '$5K-$20K' },
            { title: `${industry} Mid-Market Transformers`, size: 'Mid (50-500)', revenue: '$10M-$100M', deal: '$20K-$80K' },
            { title: `${industry} Enterprise Innovators`, size: 'Enterprise (500+)', revenue: '$100M+', deal: '$100K-$500K' }
          ]
        : [
            { title: `${industry} Niche Suppliers`, size: 'Small (10-50)', revenue: '$1M-$10M', deal: '$5K-$20K' },
            { title: `${industry} Regional Vendors`, size: 'Mid (50-500)', revenue: '$10M-$100M', deal: '$20K-$80K' },
            { title: `${industry} National Providers`, size: 'Enterprise (500+)', revenue: '$100M+', deal: '$100K-$500K' }
          ]
    );
    return base.map((b, i) => ({
      search_id: searchData.id,
      user_id: searchData.user_id,
      title: b.title,
      rank: i + 1,
      match_score: 85 + (2 - i) * 3,
      demographics: {
        industry,
        companySize: b.size,
        geography: country,
        revenue: b.revenue
      },
      characteristics: {
        painPoints: [
          searchData.search_type === 'customer' ? 'Inefficient workflows' : 'Lead volatility',
          'Integration complexity'
        ],
        motivations: [
          searchData.search_type === 'customer' ? 'Operational efficiency' : 'Recurring revenue',
          'Risk reduction'
        ],
        challenges: ['Budget constraints', 'Change management'],
        decisionFactors: ['ROI', 'Scalability', 'Support']
      },
      behaviors: {
        buyingProcess: searchData.search_type === 'customer' ? 'Pilot → Stakeholder alignment → Rollout' : 'RFP → Sample → Contract',
        decisionTimeline: i === 0 ? '1-2 months' : i === 1 ? '2-4 months' : '4-6 months',
        budgetRange: b.deal,
        preferredChannels: ['Email', 'Website', 'Referral']
      },
      market_potential: {
        totalCompanies: i === 0 ? 5000 : i === 1 ? 1200 : 200,
        avgDealSize: b.deal,
        conversionRate: i === 0 ? 6 : i === 1 ? 4 : 2
      },
      locations: [country]
    }));
  }

  try {
    // Try OpenAI first (fastest). If local dev or any error, fallback to deterministic immediately.
    let response = '';
    try {
      response = await callOpenAIChatJSON({
        model: 'gpt-5-mini',
        user: prompt,
        temperature: 0.4,
        maxTokens: 600,
        timeoutMs: 2500,
        retries: 0,
        requireJsonObject: true
      });
    } catch {
      // Immediate deterministic fallback for local speed and reliability
      const rows = deterministicPersonas();
      const insertedDet = await insertBusinessPersonas(rows);
      try { await updateSearchProgress(searchData.id, 10, 'business_personas'); } catch {}
      logger.info('✅ Deterministic Business Personas Inserted (fallback)', { search_id: searchData.id, count: insertedDet.length });
      return insertedDet;
    }

    // Parse and validate response
    let parsed;
    try {
      parsed = JSON.parse(response);
    } catch {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Invalid JSON response');
      }
    }

    if (!parsed.personas || !Array.isArray(parsed.personas)) {
      throw new Error('Invalid persona format');
    }

    // Format for database insertion
    const personaRows = parsed.personas.map((persona: any, index: number) => ({
      search_id: searchData.id,
      user_id: searchData.user_id,
      title: persona.title,
      rank: persona.rank || (index + 1),
      match_score: persona.match_score || 85,
      demographics: persona.demographics || {},
      characteristics: persona.characteristics || {},
      behaviors: persona.behaviors || {},
      market_potential: persona.market_potential || {},
      locations: Array.isArray(persona.locations) ? persona.locations : [country]
    }));

    // Insert into database
    const insertedPersonas = await insertBusinessPersonas(personaRows);
    try { await updateSearchProgress(searchData.id, 10, 'business_personas'); } catch {}
    
    logger.info('✅ Fast Business Personas Generated', { 
      search_id: searchData.id, 
      count: insertedPersonas.length 
    });
    
    return insertedPersonas;

  } catch (error: any) {
    logger.error('❌ Fast Business Persona Generation failed', { 
      search_id: searchData.id, 
      error: error.message 
    });
    throw error;
  }
}

// Fast Decision Maker Persona Generation
export async function generateDMPersonasFast(searchData: {
  id: string;
  user_id: string;
  product_service: string;
  industries: string[];
  countries: string[];
  search_type: 'customer' | 'supplier';
}) {
  logger.info('⚡ Fast DM Persona Generation', { search_id: searchData.id });

  const prompt = `3 decision makers for ${searchData.product_service}. JSON:
{"personas":[{"title":"IT Manager","rank":1,"demographics":{"ageRange":"30-45","experience":"5+ years","department":"IT"},"characteristics":{"painPoints":["Budget","Time"],"motivations":["Efficiency"],"decisionFactors":["ROI"]},"behaviors":{"communicationStyle":"Direct","preferredChannels":["Email"],"decisionTimeline":"2-4 months"},"buying_authority":"Influencer","influence_level":7}]}`;

  try {
    let response = '';
    try {
      response = await callOpenAIChatJSON({
        model: 'gpt-5-mini',
        user: prompt,
        temperature: 0.7,
        maxTokens: 600,
        timeoutMs: 5000,
        retries: 0,
        requireJsonObject: true
      });
    } catch {
      response = await callGeminiText('gemini-2.0-flash', prompt, 10000, 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(response);
    } catch {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Invalid JSON response');
      }
    }

    if (!parsed.personas || !Array.isArray(parsed.personas)) {
      throw new Error('Invalid DM persona format');
    }

    const dmPersonaRows = parsed.personas.map((persona: any, index: number) => ({
      search_id: searchData.id,
      user_id: searchData.user_id,
      title: persona.title,
      rank: persona.rank || (index + 1),
      demographics: persona.demographics || {},
      characteristics: persona.characteristics || {},
      behaviors: persona.behaviors || {},
      buying_authority: persona.buying_authority || 'Influencer',
      influence_level: persona.influence_level || 7
    }));

    const insertedDMPersonas = await insertDMPersonas(dmPersonaRows);
    
    logger.info('✅ Fast DM Personas Generated', { 
      search_id: searchData.id, 
      count: insertedDMPersonas.length 
    });
    
    return insertedDMPersonas;

  } catch (error: any) {
    logger.error('❌ Fast DM Persona Generation failed', { 
      search_id: searchData.id, 
      error: error.message 
    });
    throw error;
  }
}

// Fast Market Research Generation
export async function generateMarketResearchFast(searchData: {
  id: string;
  user_id: string;
  product_service: string;
  industries: string[];
  countries: string[];
  search_type: 'customer' | 'supplier';
}) {
  logger.info('⚡ Fast Market Research Generation', { search_id: searchData.id });

  const prompt = `Market data for ${searchData.product_service}. JSON:
{"tam_data":{"value":"$2.5B","growth":"+10%","description":"Total market","source":"research.com"},"sam_data":{"value":"$500M","growth":"+12%","description":"Serviceable market","source":"analysis.com"},"som_data":{"value":"$50M","growth":"+15%","description":"Obtainable market","source":"forecast.com"},"competitor_data":[{"name":"Leader Corp","marketShare":20,"revenue":"$800M","growth":"+5%","source":"competitive.com"}],"trends":[{"trend":"Digital Growth","impact":"High","growth":"+15%","description":"Market expansion","source":"trends.com"}],"opportunities":{"summary":"Strong growth potential","playbook":["Target SMB","Digital focus"],"market_gaps":["Underserved segments"],"timing":"Good market timing"}}`;

  try {
    let response = '';
    try {
      response = await callOpenAIChatJSON({
        model: 'gpt-5-mini',
        user: prompt,
        temperature: 0.5,
        maxTokens: 800,
        timeoutMs: 6000,
        retries: 0,
        requireJsonObject: true
      });
    } catch {
      response = await callGeminiText('gemini-2.0-flash', prompt, 12000, 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(response);
    } catch {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Invalid JSON response');
      }
    }

    // Format for database insertion
    const marketInsightRow = {
      search_id: searchData.id,
      user_id: searchData.user_id,
      tam_data: parsed.tam_data || {},
      sam_data: parsed.sam_data || {},
      som_data: parsed.som_data || {},
      competitor_data: parsed.competitor_data || [],
      trends: parsed.trends || [],
      opportunities: parsed.opportunities || {},
      sources: [
        { title: 'Market Research', url: 'https://generated-research.com', date: new Date().toISOString().slice(0, 7) }
      ],
      analysis_summary: parsed.opportunities?.summary || 'Market analysis generated',
      research_methodology: 'AI-generated market research based on industry data and trends'
    };

    const insertedInsights = await insertMarketInsights(marketInsightRow);
    
    logger.info('✅ Fast Market Research Generated', { 
      search_id: searchData.id 
    });
    
    return insertedInsights;

  } catch (error: any) {
    logger.error('❌ Fast Market Research Generation failed', { 
      search_id: searchData.id, 
      error: error.message 
    });
    throw error;
  }
}

// Fast Business Discovery (using existing debug logic)
export async function runBusinessDiscoveryFast(searchData: {
  id: string;
  user_id: string;
  product_service: string;
  industries: string[];
  countries: string[];
  search_type: 'customer' | 'supplier';
}) {
  logger.info('⚡ Fast Business Discovery', { search_id: searchData.id });

  try {
    // Use existing business discovery logic with direct insertion
    await import('../tools/serper');
    const { googlePlacesTextSearch } = await import('../tools/google-places');
    const { countryToGL, buildBusinessData } = await import('../tools/util');
    const { insertBusinesses } = await import('../tools/db.write');

    const country = searchData.countries[0] || 'United States';
    const industry = searchData.industries[0] || '';
    const gl = countryToGL(country);
    
    // Build search queries based on search type
    const baseQuery = `${searchData.product_service} ${industry} ${country}`;
    const typeSpecificQuery = searchData.search_type === 'supplier' 
      ? `${searchData.product_service} supplier manufacturer ${country}`
      : `${searchData.product_service} companies users ${country}`;

    // Parallel API calls
    const [places1, places2] = await Promise.all([
      googlePlacesTextSearch(baseQuery, gl, 5, country).catch(() => []),
      googlePlacesTextSearch(typeSpecificQuery, gl, 5, country).catch(() => [])
    ]);

    const allPlaces = [...places1, ...places2];
    
    // Deduplicate
    const unique = allPlaces.filter((place, index, array) => 
      array.findIndex(p => p.name === place.name) === index
    ).slice(0, 8);

    if (unique.length === 0) {
      logger.warn('No businesses found', { search_id: searchData.id });
      return [];
    }

    // Build business data
    const businessRows = unique.map((place: any) => buildBusinessData({
      search_id: searchData.id,
      user_id: searchData.user_id,
      persona_id: null,
      name: place.name,
      industry: industry || 'General',
      country: country,
      address: place.formatted_address || place.address || '',
      city: place.vicinity || country,
      phone: place.formatted_phone_number || undefined,
      website: place.website || undefined,
      rating: place.rating || undefined,
      size: 'Unknown',
      revenue: 'Unknown',
      description: `Business discovered via fast discovery for ${searchData.search_type} search`,
      match_score: 85,
      persona_type: searchData.search_type,
      relevant_departments: [],
      key_products: [searchData.product_service],
      recent_activity: []
    }));

    // Insert businesses
    const insertedBusinesses = await insertBusinesses(businessRows as any);
    
    logger.info('✅ Fast Business Discovery Complete', { 
      search_id: searchData.id, 
      count: insertedBusinesses.length 
    });
    
    return insertedBusinesses;

  } catch (error: any) {
    logger.error('❌ Fast Business Discovery failed', { 
      search_id: searchData.id, 
      error: error.message 
    });
    throw error;
  }
}
