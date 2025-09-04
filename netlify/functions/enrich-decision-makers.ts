import type { Handler } from '@netlify/functions';
import logger from '../../src/lib/logger';
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
  business_id?: string;
}

async function getPendingDecisionMakers(search_id: string): Promise<DecisionMaker[]> {
  const { data, error } = await supa
    .from('decision_makers')
    .select('id, name, title, company, linkedin, location, department, email, phone, search_id, user_id, business_id')
    .eq('search_id', search_id)
    .in('enrichment_status', ['pending','attempted'])
    .limit(30); // Process in slightly larger batches

  if (error) {
    logger.error('Error fetching pending decision makers', { error });
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
  "reporting_structure": "who they report to and who reports to them",
  "personalized_approach": {
    "key_message": "one-line pitch tailored to role/company",
    "value_proposition": "concise value tailored to their goals",
    "approach_strategy": "how to approach this role effectively",
    "best_contact_time": "morning|afternoon|evening",
    "preferred_channel": "email|phone|linkedin"
  },
  "company_context": {
    "industry": "best guess if not provided",
    "size": "e.g., 2500 employees",
    "revenue": "e.g., $250M",
    "priorities": ["priority 1", "priority 2"]
  }
}

Important: Return ONLY valid JSON. No markdown, no explanations, just the JSON object.`;

    // Try GPT-4o-mini first with strict JSON, fallback to Gemini if it fails
    let responseText = '';
    try {
      const res = await openai.chat.completions.create({
        model: 'gpt-5-mini',
        messages: [
          { role: 'system', content: 'Return ONLY a valid JSON object. No explanations.' },
          { role: 'user', content: `${prompt}\nReply with a single JSON object.` }
        ],
        // json_object formatting; omit temperature for GPT‑5 models to avoid 400
        response_format: { type: 'json_object' },
        max_tokens: 800
      } as any);
      responseText = (res as any).choices?.[0]?.message?.content || '';
      logger.info('Profile enriched with GPT-5-mini', { dm_id: dm.id });
    } catch (error: any) {
      logger.warn('GPT-5-mini failed, trying Gemini', { dm_id: dm.id, error: error?.message });
      try {
        const g = gemini.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
        const result = await g.generateContent(prompt);
        responseText = result.response.text();
        logger.info('Profile enriched with Gemini', { dm_id: dm.id });
      } catch (geminiError: any) {
        logger.error('Both GPT and Gemini failed for enrichment', { dm_id: dm.id, error: geminiError?.message });
        throw geminiError;
      }
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
    // Normalize enrichment fields to expected UI keys
    const normalized: any = {
      pain_points: enrichmentData.pain_points || enrichmentData.painPoints || [],
      motivations: enrichmentData.motivations || [],
      decision_factors: enrichmentData.decision_factors || enrichmentData.decisionFactors || [],
      communication_preference: enrichmentData.communication_preference || enrichmentData.communicationStyle || '',
      experience_level: enrichmentData.experience_level || enrichmentData.experience || '',
      budget_authority: enrichmentData.budget_authority || '',
      preferred_contact_method: enrichmentData.preferred_contact_method || '',
      best_contact_time: enrichmentData.best_contact_time || '',
      industry_knowledge: enrichmentData.industry_knowledge || '',
      current_challenges: enrichmentData.current_challenges || [],
      success_metrics: enrichmentData.success_metrics || [],
      reporting_structure: enrichmentData.reporting_structure || '',
      personalized_approach: enrichmentData.personalized_approach || {
        key_message: '',
        value_proposition: '',
        approach_strategy: '',
        best_contact_time: enrichmentData.best_contact_time || '',
        preferred_channel: enrichmentData.preferred_contact_method || ''
      },
      company_context: enrichmentData.company_context || {
        industry: '',
        size: '',
        revenue: '',
        priorities: []
      }
    };
    
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
    
    return normalized;
    
  } catch (error: any) {
    logger.error('Error enriching profile', { name: dm.name, error });
    
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

    logger.info('Starting decision maker enrichment', { search_id });
    
    // Get pending decision makers
    const pendingDMs = await getPendingDecisionMakers(search_id);
    logger.info('Found pending decision makers for enrichment', { count: pendingDMs.length });
    
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
          if (profile) updateData.enrichment = profile;
          if (contact.email) updateData.email = contact.email;
          if (contact.phone) updateData.phone = contact.phone;
          if (contact.linkedin && !dm.linkedin) updateData.linkedin = contact.linkedin;
          // Persist normalized enrichment fields on root columns used by UI
          if (profile) {
            updateData.pain_points = profile.pain_points || [];
            updateData.motivations = profile.motivations || [];
            updateData.decision_factors = profile.decision_factors || [];
            updateData.communication_preference = profile.communication_preference || '';
            updateData.experience = profile.experience_level || '';
            updateData.personalized_approach = profile.personalized_approach || null;
            updateData.company_context = {
              industry: profile.company_context?.industry || null,
              size: profile.company_context?.size || null,
              revenue: profile.company_context?.revenue || null,
              challenges: Array.isArray(profile.current_challenges) ? profile.current_challenges : [],
              priorities: Array.isArray(profile.company_context?.priorities) ? profile.company_context.priorities : []
            };
          }
          
          // Update enrichment metadata
          updateData.enrichment_status = contact.confidence > 0 ? 'enriched' : 'attempted';
          updateData.enrichment_confidence = contact.confidence;
          updateData.enrichment_sources = contact.sources;
          
          if (contact.verification) {
            updateData.email_verification = contact.verification;
          }

          await updateDecisionMakerEnrichment(dm.id, updateData);
          // Emit a small realtime-friendly nudge by touching updated_at via a no-op field to ensure clients refresh
          try {
            await supa.from('decision_makers').update({ updated_at: new Date().toISOString() }).eq('id', dm.id);
          } catch {}
          enrichedCount++;
          logger.info('Enriched profile', { name: dm.name, title: dm.title });
        } catch (error) {
          logger.error('Error processing DM during enrichment', { name: dm.name, error });
          errorCount++;
        }
      });
      
      await Promise.all(enrichmentPromises);
      
      // Small delay between batches to respect rate limits
      if (i + 3 < pendingDMs.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    logger.info('Enrichment completed', { search_id, enriched: enrichedCount, errors: errorCount });
    
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
    logger.error('Decision maker enrichment error', { error });
    
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