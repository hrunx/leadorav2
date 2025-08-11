import type { Handler } from '@netlify/functions';

const { createClient } = require('@supabase/supabase-js');

const supa = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

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
  try {
    // First, check if demo user exists, if not create one for testing
    let userId = '00000000-0000-0000-0000-000000000001'; // Demo user ID
    
    // Try to find an existing user first
    const { data: existingUsers } = await supa.from('user_searches').select('user_id').limit(1);
    if (existingUsers && existingUsers.length > 0) {
      userId = existingUsers[0].user_id;
    }

    // Create a test search
    const searchData = {
      user_id: userId,
      search_type: 'customer',
      product_service: 'CRM Software',
      industries: ['Technology'],
      countries: ['Saudi Arabia'],
      status: 'in_progress'
    };

    const { data: search, error } = await supa
      .from('user_searches')
      .insert(searchData)
      .select()
      .single();

    if (error) throw error;

    console.log('Test search created:', search.id);

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        success: true,
        message: 'Test search created successfully',
        search_id: search.id,
        user_id: search.user_id,
        test_curl: `curl -X POST https://6890d2bbddf903549117c637--leadora.netlify.app/.netlify/functions/agents-orchestrator-simple -H "Content-Type: application/json" -d '{"search_id":"${search.id}","user_id":"${search.user_id}"}'`
      })
    };
  } catch (error: any) {
    console.error('Failed to create test search:', error);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};