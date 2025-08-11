import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
// Removed unused AI client imports

// Initialize clients directly in function
const supa = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Optional clients (remove entirely to avoid unused warnings)

// Utility functions
const updateSearchStatus = async (search_id: string, status: string) => {
  const { error } = await supa
    .from('user_searches')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', search_id);
  if (error) throw error;
};

const loadSearch = async (search_id: string) => {
  const { data, error } = await supa.from('user_searches').select('*').eq('id', search_id).single();
  if (error) throw error; 
  return data;
};

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
    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  }

  try {
    const { search_id, user_id } = JSON.parse(event.body || '{}');
    
    if (!search_id || !user_id) {
      return { 
        statusCode: 400, 
        headers: cors,
        body: JSON.stringify({ error: 'search_id and user_id are required' }) 
      };
    }

    console.log(`Starting orchestration for search ${search_id}, user ${user_id}`);
    
    // Check if search exists
    const search = await loadSearch(search_id);
    if (!search) {
      return {
        statusCode: 404,
        headers: cors,
        body: JSON.stringify({ error: 'Search not found' })
      };
    }

    // Update status to in_progress
    await updateSearchStatus(search_id, 'in_progress');

    // For now, let's just simulate the process and mark as completed
    // This proves the function works before adding the complex agent logic
    console.log('Search found:', search.product_service, search.industries, search.countries);
    
    // Simulate some work
    console.log('Simulating agent work...');
    
    // Mark as completed
    await updateSearchStatus(search_id, 'completed');
    
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ 
        success: true, 
        message: 'Agent orchestration completed successfully (simulated)',
        search_id,
        search_details: {
          product_service: search.product_service,
          industries: search.industries,
          countries: search.countries,
          search_type: search.search_type
        }
      })
    };
  } catch (error: any) {
    console.error('Agent orchestration failed:', error);
    
    // Update search status to failed
    try {
      const { search_id } = JSON.parse(event.body || '{}');
      if (search_id) {
        await updateSearchStatus(search_id, 'in_progress'); // Keep as in_progress for now since schema only has 'in_progress' and 'completed'
      }
    } catch (updateError) {
      console.error('Failed to update search status:', updateError);
    }
    
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ 
        success: false, 
        error: error.message,
        details: 'Agent orchestration failed'
      })
    };
  }
};