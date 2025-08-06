import { supa } from '../agents/clients';

/**
 * Maps businesses to personas once both are available
 * This runs after business discovery and persona generation complete
 */
export async function mapBusinessesToPersonas(searchId: string) {
  try {
    console.log(`Starting persona mapping for search ${searchId}`);
    
    // Get all businesses without proper persona mapping
    const { data: businesses, error: businessError } = await supa
      .from('businesses')
      .select('*')
      .eq('search_id', searchId)
      .is('persona_id', null);
    
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
 * Enhanced persona mapping using AI-based matching
 * This provides more intelligent mapping based on business characteristics
 */
export async function intelligentPersonaMapping(searchId: string, userMessage?: string) {
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
          // Add scoring logic based on business description matching persona characteristics
          score += Math.random() * 10; // Placeholder for semantic matching
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