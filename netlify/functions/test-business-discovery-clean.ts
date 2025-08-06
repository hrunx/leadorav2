import { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  try {
    console.log('🚀 Testing clean business discovery...');
    
    // Create a new test search
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Create test search
    const testSearch = {
      user_id: '0f63cc8c-03b0-4d4c-bddf-0c7ccecc7edb',
      search_type: 'customer',
      product_service: 'ev chargers',
      industries: ['automotive'],
      countries: ['US', 'CA'],
      status: 'in_progress'
    };

    const { data: newSearch, error: searchError } = await supabase
      .from('user_searches')
      .insert(testSearch)
      .select()
      .single();

    if (searchError) throw searchError;

    console.log('✅ Created test search:', newSearch.id);

    // Test business discovery directly
    const { execBusinessDiscovery } = await import('../../src/orchestration/exec-business-discovery');
    
    console.log('🔍 Running business discovery...');
    const result = await execBusinessDiscovery({
      search_id: newSearch.id,
      user_id: newSearch.user_id
    });

    console.log('✅ Business discovery completed');

    // Check how many businesses were found
    const { data: businesses } = await supabase
      .from('businesses')
      .select('*')
      .eq('search_id', newSearch.id);

    console.log(`📊 Found ${businesses?.length || 0} businesses`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        search_id: newSearch.id,
        businesses_found: businesses?.length || 0,
        sample_businesses: (businesses || []).slice(0, 3).map(b => ({
          name: b.name,
          country: b.country,
          industry: b.industry,
          address: b.address,
          phone: b.phone,
          website: b.website
        })),
        result: result
      })
    };

  } catch (error: any) {
    console.error('💥 Test failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Test failed', 
        details: error.message,
        stack: error.stack 
      })
    };
  }
};