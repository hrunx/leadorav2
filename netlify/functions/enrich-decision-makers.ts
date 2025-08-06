import type { Handler } from '@netlify/functions';
import { supa } from '../../src/agents/clients';
import { gemini } from '../../src/agents/clients';
import { updateDecisionMakerEnrichment, logApiUsage } from '../../src/tools/db.write';

interface DecisionMaker {
  id: string;
  name: string;
  title: string;
  company: string;
  linkedin: string;
  location: string;
  department: string;
  search_id: string;
  user_id: string;
}

async function getPendingDecisionMakers(search_id: string): Promise<DecisionMaker[]> {
  const { data, error } = await supa
    .from('decision_makers')
    .select('id, name, title, company, linkedin, location, department, search_id, user_id')
    .eq('search_id', search_id)
    .eq('enrichment_status', 'pending')
    .limit(20); // Process in batches

  if (error) {
    console.error('Error fetching pending decision makers:', error);
    throw error;
  }

  return data || [];
}

async function enrichDecisionMakerProfile(dm: DecisionMaker): Promise<any | null> {
  try {
    const model = gemini.getGenerativeModel({ model: 'gemini-1.5-pro' });
    
    const prompt = `Analyze this decision maker profile and generate enrichment data:

Name: ${dm.name}
Title: ${dm.title}
Company: ${dm.company}
Department: ${dm.department}
Location: ${dm.location}

Generate enrichment JSON with the following structure:
{
  "pain_points": ["specific pain point 1", "specific pain point 2", "specific pain point 3"],
  "motivations": ["key motivation 1", "key motivation 2", "key motivation 3"],
  "decision_factors": ["decision factor 1", "decision factor 2", "decision factor 3"],
  "communication_preference": "preferred communication style",
  "experience_level": "junior|mid|senior|executive",
  "budget_authority": "low|medium|high",
  "preferred_contact_method": "email|phone|linkedin",
  "best_contact_time": "morning|afternoon|evening",
  "industry_knowledge": "specific industry insights",
  "current_challenges": ["challenge 1", "challenge 2"],
  "success_metrics": ["metric 1", "metric 2"],
  "reporting_structure": "who they report to and who reports to them"
}

Important: Return ONLY valid JSON. No markdown, no explanations, just the JSON object.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // Clean up JSON response
    let cleanJson = responseText.trim();
    
    // Remove markdown code blocks if present
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    
    // Remove trailing commas and comments
    cleanJson = cleanJson
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    
    const enrichmentData = JSON.parse(cleanJson);
    
    // Log successful API usage
    await logApiUsage({
      user_id: dm.user_id,
      search_id: dm.search_id,
      provider: 'gemini',
      endpoint: 'enrichment',
      status: 200,
      request: { dm_id: dm.id, name: dm.name },
      response: { enriched: true }
    });
    
    return enrichmentData;
    
  } catch (error: any) {
    console.error(`Error enriching profile for ${dm.name}:`, error);
    
    // Log failed API usage
    await logApiUsage({
      user_id: dm.user_id,
      search_id: dm.search_id,
      provider: 'gemini',
      endpoint: 'enrichment',
      status: 500,
      request: { dm_id: dm.id, name: dm.name },
      response: { error: error.message }
    });
    
    return null;
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { search_id } = JSON.parse(event.body || '{}');
    
    if (!search_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'search_id is required' })
      };
    }

    console.log(`Starting decision maker enrichment for search ${search_id}`);
    
    // Get pending decision makers
    const pendingDMs = await getPendingDecisionMakers(search_id);
    console.log(`Found ${pendingDMs.length} pending decision makers for enrichment`);
    
    if (pendingDMs.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'No pending decision makers found',
          search_id,
          enriched: 0
        })
      };
    }
    
    let enrichedCount = 0;
    let errorCount = 0;
    
    // Process decision makers in small batches to avoid rate limits
    for (let i = 0; i < pendingDMs.length; i += 3) {
      const batch = pendingDMs.slice(i, i + 3);
      
      // Process batch in parallel
      const enrichmentPromises = batch.map(async (dm) => {
        try {
          const enrichmentData = await enrichDecisionMakerProfile(dm);
          
          if (enrichmentData) {
            await updateDecisionMakerEnrichment(dm.id, enrichmentData);
            enrichedCount++;
            console.log(`Enriched profile for ${dm.name} (${dm.title})`);
          } else {
            errorCount++;
            console.log(`Failed to enrich profile for ${dm.name}`);
          }
        } catch (error) {
          console.error(`Error processing ${dm.name}:`, error);
          errorCount++;
        }
      });
      
      await Promise.all(enrichmentPromises);
      
      // Small delay between batches to respect rate limits
      if (i + 3 < pendingDMs.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`Enrichment completed for search ${search_id}: ${enrichedCount} successful, ${errorCount} errors`);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        search_id,
        total_pending: pendingDMs.length,
        enriched: enrichedCount,
        errors: errorCount,
        message: `Enriched ${enrichedCount} decision maker profiles`
      })
    };
    
  } catch (error: any) {
    console.error('Decision maker enrichment error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        message: 'Failed to enrich decision maker profiles'
      })
    };
  }
};