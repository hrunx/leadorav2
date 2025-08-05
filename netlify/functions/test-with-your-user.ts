import type { Handler } from '@netlify/functions';

const { createClient } = require('@supabase/supabase-js');

const supa = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const handler: Handler = async (event) => {
  try {
    const YOUR_USER_ID = '0f63cc8c-03b0-4d4c-bddf-0c7ccecc7edb';
    
    // Create a test search with your actual user ID
    const searchData = {
      user_id: YOUR_USER_ID,
      search_type: 'customer',
      product_service: 'AI-powered Marketing Automation',
      industries: ['Technology', 'SaaS'],
      countries: ['United States', 'Canada'],
      status: 'in_progress'
    };

    const { data: search, error } = await supa
      .from('user_searches')
      .insert(searchData)
      .select()
      .single();

    if (error) throw error;

    console.log('Test search created with your user ID:', search.id);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Test search created successfully with your user ID',
        search_id: search.id,
        user_id: search.user_id,
        search_details: search,
        test_orchestrator: `curl -X POST https://leadora.net/.netlify/functions/agents-orchestrator -H "Content-Type: application/json" -d '{"search_id":"${search.id}","user_id":"${YOUR_USER_ID}"}'`,
        problem_status: 'This creates the search successfully, but the orchestrator will fail with 502 due to ES module import issues detailed in COMPLETE_PROBLEM_ANALYSIS.md'
      })
    };
  } catch (error: any) {
    console.error('Failed to create test search:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
        details: 'Check COMPLETE_PROBLEM_ANALYSIS.md for full technical details'
      })
    };
  }
};