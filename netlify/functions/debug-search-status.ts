import { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  try {
    const { search_id } = JSON.parse(event.body || '{}');
    
    if (!search_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'search_id required' })
      };
    }

    console.log(`🔍 Debugging search status for: ${search_id}`);
    
    // Import database functions
    const { loadSearch } = await import('../../src/tools/db.read');
    const { loadBusinesses } = await import('../../src/tools/db.read');
    
    // Check search status
    const search = await loadSearch(search_id);
    if (!search) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Search not found', search_id })
      };
    }
    
    // Check businesses
    const businesses = await loadBusinesses(search_id);
    
    console.log(`📊 Search Status:`, {
      id: search.id,
      status: search.status,
      current_phase: search.current_phase,
      progress_pct: search.progress_pct,
      product_service: search.product_service,
      industries: search.industries,
      countries: search.countries,
      businesses_found: businesses.length
    });
    
    // Check user_searches table for progress
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    
    const { data: searchProgress } = await supabase
      .from('user_searches')
      .select('*')
      .eq('id', search_id)
      .single();
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        search_found: true,
        search_details: {
          id: search.id,
          status: search.status,
          current_phase: search.current_phase,
          progress_pct: search.progress_pct,
          product_service: search.product_service,
          industries: search.industries,
          countries: search.countries,
          created_at: search.created_at,
          updated_at: search.updated_at
        },
        businesses_count: businesses.length,
        sample_businesses: businesses.slice(0, 3).map(b => ({
          name: b.name,
          industry: b.industry,
          country: b.country,
          address: b.address
        })),
        search_progress: searchProgress
      })
    };

  } catch (error: any) {
    console.error('💥 Debug failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Debug failed', 
        details: error.message,
        stack: error.stack 
      })
    };
  }
};