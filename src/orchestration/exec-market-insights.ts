import { gemini } from '../agents/clients';
import { loadBusinessPersonas, loadBusinesses, loadDMPersonas, loadSearch } from '../tools/db.read';
import { insertMarketInsights, logApiUsage } from '../tools/db.write';
import logger from '../lib/logger';
import { MarketInsightsSchema } from '../lib/marketInsightsSchema';

export async function execMarketInsights(payload: {
  search_id: string;
  user_id: string;
}) {
  const search = await loadSearch(payload.search_id);
  if (!search) throw new Error(`Search ${payload.search_id} not found`);

  const [bp, biz, dmp] = await Promise.all([
    loadBusinessPersonas(search.id),
    loadBusinesses(search.id),
    loadDMPersonas(search.id),
  ]);

  const prompt = `
You are a market research analyst. Create comprehensive market insights for the UI.

Product/Service: ${search.product_service}
Industry: ${search.industries[0]}
Target Countries: ${search.countries.join(', ')}

Business Context:
- Found ${bp.length} business personas: ${bp.map((p:any) => p.title).join(', ')}
- Discovered ${biz.length} real businesses: ${biz.map((b:any) => b.name).slice(0,5).join(', ')}
- Identified ${dmp.length} decision maker types: ${dmp.map((p:any) => p.title).join(', ')}

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
    {
      "name": "Company Name",
      "marketShare": "XX%",
      "description": "Brief description",
      "strengths": ["strength1", "strength2"],
      "weaknesses": ["weakness1", "weakness2"]
    }
  ],
  "trends": [
    {
      "title": "Trend Name",
      "impact": "High/Medium/Low",
      "description": "Brief description",
      "timeline": "timeframe"
    }
  ],
  "opportunities": [
    {
      "title": "Opportunity Name", 
      "description": "Brief description",
      "potential": "High/Medium/Low",
      "timeframe": "Short/Medium/Long term"
    }
  ]
}

Return only valid JSON, no other text.`;

  const startTime = Date.now();
  try {
    const model = gemini.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    // Log successful API usage
    await logApiUsage({
      user_id: search.user_id,
      search_id: search.id,
      provider: 'gemini',
      endpoint: 'generateContent',
      status: 200,
      ms: Date.now() - startTime,
      request: { model: 'gemini-1.5-flash', prompt_length: prompt.length },
      response: { response_length: text.length }
    });
    
    // Parse and validate JSON - handle markdown code blocks
    let cleanText = text.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    const insights = JSON.parse(cleanText);

    const parsed = MarketInsightsSchema.safeParse(insights);
    if (!parsed.success) {
      logger.error('Invalid market insights from Gemini', { error: parsed.error });
      throw new Error('Invalid market insights format');
    }
    const valid = parsed.data;

    // Store in database
    return await insertMarketInsights({
      search_id: search.id,
      user_id: search.user_id,
      tam_data: valid.tam_data,
      sam_data: valid.sam_data,
      som_data: valid.som_data,
      competitor_data: valid.competitor_data,
      trends: valid.trends,
      opportunities: valid.opportunities,
      sources: valid.sources,
      analysis_summary: valid.analysis_summary,
      research_methodology: valid.research_methodology
    });
    
  } catch (error: any) {
    // Log failed API usage
    await logApiUsage({
      user_id: search.user_id,
      search_id: search.id,
      provider: 'gemini',
      endpoint: 'generateContent',
      status: 500,
      ms: Date.now() - startTime,
      request: { model: 'gemini-1.5-flash', prompt_length: prompt.length },
      response: { error: error.message }
    });
    throw error;
  }
}