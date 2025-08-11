import type { Handler } from '@netlify/functions';
import { supa, openai, gemini } from '../../src/agents/clients';
import { updateDecisionMakerEnrichment, logApiUsage } from '../../src/tools/db.write';
import { fetchContactEnrichment } from '../../src/tools/contact-enrichment';

interface DecisionMaker {
  id: string;
  name: string;
  title: string;
  company: string;
  linkedin: string;
  location: string;
  department: string;
  email?: string;
  phone?: string;
  search_id: string;
  user_id: string;
}

async function getPendingDecisionMakers(search_id: string): Promise<DecisionMaker[]> {
  const { data, error } = await supa
    .from('decision_makers')
    .select('id, name, title, company, linkedin, location, department, email, phone, search_id, user_id')
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

    // Try GPT-5 first with strict JSON, fallback to Gemini if it fails
    let responseText = '';
    try {
      const res = await openai.chat.completions.create({
        model: 'gpt-5',
        messages: [
          { role: 'system', content: 'You output ONLY valid JSON object.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' }
      });
      responseText = res.choices?.[0]?.message?.content || '';
    } catch {
      const g = gemini.getGenerativeModel({ model: 'gemini-1.5-pro' });
      const result = await g.generateContent(prompt);
      responseText = result.response.text();
    }
    
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
      provider: 'openai',
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
      provider: 'openai',
      endpoint: 'enrichment',
      status: 500,
      request: { dm_id: dm.id, name: dm.name },
      response: { error: error.message }
    });
    
    return null;
  }
}

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, apikey, X-Requested-With',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: cors,
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
          const [profile, contact] = await Promise.all([
            enrichDecisionMakerProfile(dm),
            fetchContactEnrichment(dm.name, dm.company)
          ]);

          // Store AI profile under enrichment JSON to avoid schema mismatch
          const updateData: any = {};
          if (profile) {
            updateData.enrichment = profile;
          }
          if (contact.email) updateData.email = contact.email;
          if (contact.phone) updateData.phone = contact.phone;
          if (contact.verification) {
            updateData.email_verification = contact.verification;
            updateData.enrichment_status = contact.verification.status || 'enriched';
            updateData.enrichment_confidence = contact.verification.score;
            updateData.enrichment_sources = [contact.source];
          }

          await updateDecisionMakerEnrichment(dm.id, updateData);
          enrichedCount++;
          console.log(`Enriched profile for ${dm.name} (${dm.title})`);
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
        headers: { 'Content-Type': 'application/json', ...cors },
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
      headers: { 'Content-Type': 'application/json', ...cors },
      body: JSON.stringify({
        success: false,
        error: error.message,
        message: 'Failed to enrich decision maker profiles'
      })
    };
  }
};