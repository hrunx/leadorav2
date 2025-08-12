import type { Handler } from '@netlify/functions';
import logger from '../../src/lib/logger';
import { createClient } from '@supabase/supabase-js';

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
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

    logger.info('Test search created with your user ID', { search_id: search.id });

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        success: true,
        message: 'Test search created successfully with your user ID',
        search_id: search.id,
        user_id: search.user_id,
        search_details: search,
        test_orchestrator: `curl -X POST https://leadora.net/.netlify/functions/orchestrator-run-background -H "Content-Type: application/json" -d '{"search_id":"${search.id}","user_id":"${YOUR_USER_ID}"}'`,
        problem_status: 'This creates the search successfully and triggers the background orchestrator.'
      })
    };
  } catch (error: any) {
    logger.error('Failed to create test search', { error });
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({
        success: false,
        error: error.message,
        details: 'Check COMPLETE_PROBLEM_ANALYSIS.md for full technical details'
      })
    };
  }
};
