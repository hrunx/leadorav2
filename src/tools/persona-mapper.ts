import { supa } from '../agents/clients';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { mapDMToPersona } from './util';

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
      console.log('No personas available yet for mapping');
      return;
    }

    console.log(`Mapping ${businesses.length} businesses to ${personas.length} personas`);

    // Simple mapping logic: distribute businesses across personas based on match criteria
    const updates = businesses.map((business, index) => {
      // Use round-robin distribution for now, but could be enhanced with AI matching
      const persona = personas[index % personas.length];

      return supa
        .from('businesses')
        .update({
          persona_id: persona.id,
          persona_type: persona.title,
          // Boost match score slightly since we now have proper persona mapping
          match_score: Math.min(business.match_score + 5, 100)
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