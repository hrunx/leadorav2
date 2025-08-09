import { supa } from '../agents/clients';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { mapDMToPersona } from './util';

// Intelligent business-persona matching functions
function findBestMatchingPersona(business: any, personas: any[]): any {
  let bestPersona = personas[0];
  let bestScore = 0;

  for (const persona of personas) {
    const score = calculatePersonaMatchScore(business, persona);
    if (score > bestScore) {
      bestScore = score;
      bestPersona = persona;
    }
  }

  return bestPersona;
}

function calculatePersonaMatchScore(business: any, persona: any): number {
  let score = business.match_score || 75; // Base score

  // Analyze business characteristics for persona compatibility
  const businessName = (business.name || '').toLowerCase();
  const businessDesc = (business.description || '').toLowerCase();
  const businessIndustry = (business.industry || '').toLowerCase();
  const businessSize = (business.size || '').toLowerCase();
  const businessRevenue = (business.revenue || '').toLowerCase();
  
  const personaTitle = (persona.title || '').toLowerCase();
  const personaDemos = persona.demographics || {};
  const personaChars = persona.characteristics || {};
  
  // Size-based matching
  if (businessSize.includes('small') || businessSize.includes('startup')) {
    if (personaTitle.includes('small') || personaTitle.includes('startup') || personaTitle.includes('emerging')) {
      score += 15;
    }
  } else if (businessSize.includes('large') || businessSize.includes('enterprise')) {
    if (personaTitle.includes('large') || personaTitle.includes('enterprise') || personaTitle.includes('corporate')) {
      score += 15;
    }
  }

  // Revenue-based matching
  if (businessRevenue.includes('million') || businessRevenue.includes('high')) {
    if (personaTitle.includes('premium') || personaTitle.includes('enterprise') || personaTitle.includes('corporate')) {
      score += 10;
    }
  }

  // Industry-specific matching
  if (businessIndustry) {
    if (personaTitle.includes(businessIndustry) || personaDemos?.industries?.includes?.(businessIndustry)) {
      score += 20;
    }
  }

  // Technology/Innovation matching
  if (businessName.includes('tech') || businessDesc.includes('software') || businessDesc.includes('digital')) {
    if (personaTitle.includes('tech') || personaTitle.includes('digital') || personaTitle.includes('innovative')) {
      score += 10;
    }
  }

  // Traditional business matching
  if (businessDesc.includes('traditional') || businessDesc.includes('established') || businessDesc.includes('family')) {
    if (personaTitle.includes('traditional') || personaTitle.includes('established') || personaTitle.includes('conservative')) {
      score += 10;
    }
  }

  // Geographic considerations (if available)
  const businessLocation = (business.city || business.country || '').toLowerCase();
  if (businessLocation.includes('urban') || businessLocation.includes('city')) {
    if (personaTitle.includes('urban') || personaTitle.includes('metropolitan')) {
      score += 5;
    }
  }

  // Keyword overlap between business description and persona characteristics
  if (personaChars) {
    const charsStr = JSON.stringify(personaChars).toLowerCase();
    const keywords = ['energy','logistics','supply','diesel','retail','manufacturing','healthcare','finance','saas','crm','automation'];
    let hits = 0;
    for (const k of keywords) {
      if (businessDesc.includes(k) && charsStr.includes(k)) hits++;
    }
    score += Math.min(hits * 3, 15);
  }

  // Revenue/size alignment bonus if persona demographics encode ranges
  if (personaDemos && typeof personaDemos.companySize === 'string') {
    const size = personaDemos.companySize.toLowerCase();
    if (businessSize && size.includes(businessSize.split('-')[0])) score += 5;
  }

  // Ensure score doesn't exceed reasonable bounds
  return Math.min(score, 100);
}

/**
 * Maps any businesses without a persona assignment to the available personas.
 *
 * When called repeatedly this function will only operate on businesses that
 * have not yet been mapped (persona_id is null) which enables incremental
 * updates as new businesses arrive.
 */
export async function mapBusinessesToPersonas(searchId: string, businessId?: string) {
  try {
    console.log(`Starting persona mapping for search ${searchId}`);

    // Ensure business personas exist before mapping
    const { data: personaCheck } = await supa
      .from('business_personas')
      .select('id')
      .eq('search_id', searchId)
      .limit(1);
    if (!personaCheck || personaCheck.length === 0) {
      console.log('Business personas not ready yet. Deferring mapping by 5s.');
      setTimeout(() => { mapBusinessesToPersonas(searchId, businessId).catch(()=>{}); }, 5000);
      return;
    }

    // Only load businesses that don't yet have a persona mapping. Optionally
    // limit to a single business when an id is provided.
    const businessQuery = supa
      .from('businesses')
      .select('*')
      .eq('search_id', searchId)
      .is('persona_id', null);
    if (businessId) businessQuery.eq('id', businessId);
    const { data: businesses, error: businessError } = await businessQuery;

    if (businessError) throw businessError;
    if (!businesses || businesses.length === 0) {
      console.log('No businesses found requiring persona mapping');
      return;
    }

    // Get all personas for this search
    const { data: personas, error: personaError } = await supa
      .from('business_personas')
      .select('*')
      .eq('search_id', searchId)
      .order('rank');

    if (personaError) throw personaError;
    if (!personas || personas.length === 0) {
      console.log('No personas available yet for mapping, retrying in background');
      // retry later without throwing to avoid blocking inserts
      setTimeout(() => {
        mapBusinessesToPersonas(searchId, businessId).catch(() => {});
      }, 5000);
      return;
    }

    console.log(`Mapping ${businesses.length} businesses to ${personas.length} personas`);

    // Intelligent mapping logic: analyze business characteristics for best-fit persona matching
    const updates = businesses.map((business) => {
      // Find the best matching persona based on business characteristics
      const bestPersona = findBestMatchingPersona(business, personas);
      const matchScore = calculatePersonaMatchScore(business, bestPersona);

      return supa
        .from('businesses')
        .update({
          persona_id: bestPersona.id,
          persona_type: bestPersona.title || 'mapped',
          // Use calculated match score based on persona compatibility
          match_score: Math.min(matchScore, 100)
        })
        .eq('id', business.id);
    });

    // Execute all updates in parallel
    const results = await Promise.allSettled(updates);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`Persona mapping completed: ${successful} successful, ${failed} failed`);

    return { successful, failed, total: businesses.length };
  } catch (error) {
    console.error('Error mapping businesses to personas:', error);
    throw error;
  }
}

/**
 * Starts a Supabase realtime listener that maps businesses to personas whenever
 * a new business row is inserted for the given search.
 *
 * Returns a cleanup function that should be awaited to unsubscribe from the
 * realtime channel when work is complete.
 */
export function startPersonaMappingListener(searchId: string) {
  const channel = supa
    .channel(`persona-mapper-${searchId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'businesses',
        filter: `search_id=eq.${searchId}`
      },
      (payload: RealtimePostgresChangesPayload<{ id: string }>) => {
        mapBusinessesToPersonas(searchId, payload.new.id).catch(err =>
          console.error('Error mapping persona for new business:', err)
        );
      }
    )
    .subscribe();

  return async () => {
    await supa.removeChannel(channel);
  };
}

/**
 * Enhanced persona mapping using AI-based matching
 * This provides more intelligent mapping based on business characteristics
 */
export async function intelligentPersonaMapping(searchId: string) {
  try {
    // Get businesses and personas
    const [businessResult, personaResult] = await Promise.all([
      supa.from('businesses').select('*').eq('search_id', searchId),
      supa.from('business_personas').select('*').eq('search_id', searchId).order('rank')
    ]);
    
    if (businessResult.error) throw businessResult.error;
    if (personaResult.error) throw personaResult.error;
    
    const businesses = businessResult.data || [];
    const personas = personaResult.data || [];
    
    if (businesses.length === 0 || personas.length === 0) {
      console.log('Insufficient data for intelligent mapping');
      return await mapBusinessesToPersonas(searchId); // Fallback to simple mapping
    }
    
    // For now, use enhanced round-robin with industry/size matching
    // TODO: Integrate with AI for semantic matching
    const updates = businesses.map((business) => {
      // Find best matching persona based on characteristics
      let bestPersona = personas[0]; // Default to first persona
      let bestScore = 0;
      
      personas.forEach(persona => {
        let score = 0;
        
        // Match based on demographics if available
        if (persona.demographics) {
          if (persona.demographics.industry === business.industry) score += 30;
          if (persona.demographics.companySize && business.size.includes(persona.demographics.companySize.split('-')[0])) score += 20;
        }
        
        // Match based on characteristics 
        if (persona.characteristics) {
          // Use deterministic scoring based on actual characteristics matching
          const businessDesc = business.description?.toLowerCase() || '';
          const personaChars = JSON.stringify(persona.characteristics).toLowerCase();
          
          // Look for keyword overlaps between business and persona
          const commonWords = ['technology', 'software', 'service', 'manufacturing', 'retail', 'healthcare', 'finance'];
          let matchCount = 0;
          
          for (const word of commonWords) {
            if (businessDesc.includes(word) && personaChars.includes(word)) {
              matchCount++;
            }
          }
          
          score += matchCount * 2; // Add 2 points per matching characteristic
        }
        
        if (score > bestScore) {
          bestScore = score;
          bestPersona = persona;
        }
      });
      
      return supa
        .from('businesses')
        .update({
          persona_id: bestPersona.id,
          persona_type: bestPersona.title,
          match_score: Math.min(business.match_score + bestScore / 10, 100)
        })
        .eq('id', business.id);
    });
    
    const results = await Promise.allSettled(updates);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    
    console.log(`Intelligent persona mapping completed: ${successful}/${businesses.length} businesses mapped`);
    
    return { successful, failed: businesses.length - successful, total: businesses.length };
  } catch (error) {
    console.error('Error in intelligent persona mapping:', error);
    // Fallback to simple mapping
    return await mapBusinessesToPersonas(searchId);
  }
}

/**
 * Maps decision makers without persona assignments once personas are available
 */
export async function mapDecisionMakersToPersonas(searchId: string) {
  try {
    console.log(`Starting DM persona mapping for search ${searchId}`);

    // Ensure DM personas exist before mapping
    const { data: personaCheck } = await supa
      .from('decision_maker_personas')
      .select('id')
      .eq('search_id', searchId)
      .limit(1);
    if (!personaCheck || personaCheck.length === 0) {
      console.log('DM personas not ready yet. Deferring mapping by 5s.');
      setTimeout(() => { mapDecisionMakersToPersonas(searchId).catch(()=>{}); }, 5000);
      return;
    }

    const { data: dms, error: dmError } = await supa
      .from('decision_makers')
      .select('id,title')
      .eq('search_id', searchId)
      .is('persona_id', null);

    if (dmError) throw dmError;
    if (!dms || dms.length === 0) {
      console.log('No decision makers found requiring persona mapping');
      return;
    }

    const { data: personas, error: personaError } = await supa
      .from('decision_maker_personas')
      .select('id,title,rank')
      .eq('search_id', searchId)
      .order('rank');

    if (personaError) throw personaError;
    if (!personas || personas.length === 0) {
      console.log('No DM personas available yet for mapping');
      return;
    }

    const updates = dms.map(dm => {
      const persona = mapDMToPersona(dm, personas);
      return supa
        .from('decision_makers')
        .update({ persona_id: persona?.id || personas[0].id })
        .eq('id', dm.id);
    });

    const results = await Promise.allSettled(updates);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`DM persona mapping completed: ${successful} successful, ${failed} failed`);

    return { successful, failed, total: dms.length };
  } catch (error) {
    console.error('Error mapping decision makers to personas:', error);
    throw error;
  }
}