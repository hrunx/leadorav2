import { gemini } from './clients';
import { loadBusinessPersonas, loadBusinesses, loadDMPersonas } from '../tools/db.read';
import { insertMarketInsights, updateSearchProgress, markSearchCompleted, logApiUsage } from '../tools/db.write';
import { extractJson } from '../tools/json';

export async function runMarketResearch(search: {
  id:string; 
  user_id:string; 
  product_service:string; 
  industries:string[]; 
  countries:string[];
  search_type: 'customer' | 'supplier';
}) {
  try {
    await updateSearchProgress(search.id, 90, 'market_research', 'in_progress');
    console.log(`Starting market research for search ${search.id}`);
    
    const [bp, biz, dmp] = await Promise.all([
      loadBusinessPersonas(search.id),
      loadBusinesses(search.id),
      loadDMPersonas(search.id),
    ]);

  const prompt = `
You are an expert market research analyst providing investor-grade analysis. Create comprehensive market insights PRECISELY tailored to the specific search criteria.

EXACT SEARCH CONTEXT:
Product/Service: ${search.product_service}
Target Industries: ${search.industries.join(', ')}
Target Countries: ${search.countries.join(', ')}
Search Type: ${search.search_type === 'customer' ? 'Customer Discovery' : 'Supplier Discovery'}

DISCOVERED BUSINESS INTELLIGENCE:
- Business Personas (${bp.length}): ${bp.map((p:any) => p.title).join(', ')}
- Real Companies (${biz.length}): ${biz.map((b:any) => b.name).slice(0,10).join(', ')}
- Decision Makers (${dmp.length}): ${dmp.map((p:any) => p.title).join(', ')}

CRITICAL REQUIREMENTS:
1. Focus EXCLUSIVELY on ${search.product_service} market across ALL specified countries (${search.countries.join(', ')})
2. Use industry-specific data and metrics for ALL specified industries (${search.industries.join(', ')})
3. Reference the actual discovered businesses and personas in analysis
4. Provide country-specific market size calculations for each target country
5. Include regulatory and cultural factors for ALL target countries
6. Calculate market size "pinned to every dollar" with strong sources
7. Provide investor-grade analysis with visible source links
8. Consider cross-industry and cross-border opportunities for the specified product/service

Generate this EXACT JSON structure:
{
  "tam_data": {
    "value": "$X.XB",
    "growth": "+XX%", 
    "description": "Total Addressable Market",
    "calculation": "methodology and assumptions"
  },
  "sam_data": {
    "value": "$XXXMn", 
    "growth": "+XX%",
    "description": "Serviceable Addressable Market",
    "calculation": "methodology and assumptions"
  },
  "som_data": {
    "value": "$XXMn",
    "growth": "+XX%", 
    "description": "Serviceable Obtainable Market",
    "calculation": "methodology and assumptions"
  },
  "competitor_data": [
    {"name": "Company Name", "marketShare": XX, "revenue": "$XXXMn", "growth": "+XX%", "notes": "competitive analysis"},
    ... (4-5 competitors total)
  ],
  "trends": [
    {"trend": "Trend Name", "impact": "High/Medium/Low", "growth": "+XX%", "description": "detailed impact analysis"},
    ... (4-5 trends total)
  ],
  "opportunities": {
    "summary": "Key market opportunities overview",
    "playbook": ["actionable strategy 1", "actionable strategy 2", "actionable strategy 3"],
    "market_gaps": ["gap 1", "gap 2"],
    "timing": "market timing analysis"
  }
}

Requirements:
- Use realistic market data for this industry/country
- Base TAM/SAM/SOM on actual business personas and companies found
- Include real competitor analysis based on the businesses discovered
- Provide actionable insights, not generic advice
- Use proper formatting: $2.4B, $850M, +15%, etc.
`;

  const startTime = Date.now();
  const model = gemini.getGenerativeModel({ model: 'gemini-1.5-pro' });
  
  try {
    const res = await model.generateContent([{ text: prompt }]);
    const text = res.response.text().trim();
    
    // Log successful API usage to Gemini
    await logApiUsage({
      user_id: search.user_id,
      search_id: search.id,
      provider: 'gemini',
      endpoint: 'market_research',
      status: 200,
      ms: Date.now() - startTime,
      request: { model: 'gemini-1.5-pro', business_count: biz.length, persona_count: bp.length },
      response: { text_length: text.length }
    });

      // Try to extract JSON using utility
      const json = extractJson(text);
      if (!json) {
        console.error('Failed to parse market research response', {
          responseSnippet: text.slice(0, 200)
        });
      }

      const data = json || {
        tam_data: {},
        sam_data: {},
        som_data: {},
        competitor_data: [],
        trends: [],
        opportunities: {}
      };

      const row = {
        search_id: search.id,
        user_id: search.user_id,
        tam_data: data.tam_data || {},
        sam_data: data.sam_data || {},
        som_data: data.som_data || {},
        competitor_data: data.competitor_data || [],
        trends: data.trends || [],
        opportunities: data.opportunities || {}
      };

    await insertMarketInsights(row);
    await markSearchCompleted(search.id);
    console.log(`Completed market research for search ${search.id}`);
    
  } catch (error: any) {
    // Log failed API usage
    await logApiUsage({
      user_id: search.user_id,
      search_id: search.id,
      provider: 'gemini',
      endpoint: 'market_research',
      status: 500,
      ms: Date.now() - startTime,
      request: { model: 'gemini-1.5-pro', business_count: biz.length, persona_count: bp.length },
      response: { error: error.message }
    });
    throw error;
  }
  } catch (error) {
    console.error(`Market research failed for search ${search.id}:`, error);
    throw error;
  }
}