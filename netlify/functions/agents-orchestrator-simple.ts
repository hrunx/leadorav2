import type { Handler } from '@netlify/functions';

// Direct imports without the complex orchestration layer
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize clients directly in function
const supa = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY!,
});

const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { search_id, user_id } = JSON.parse(event.body || '{}');
    
    if (!search_id || !user_id) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: 'search_id and user_id are required' }) 
      };
    }

    console.log(`Starting orchestration for search ${search_id}, user ${user_id}`);
    
    // Check if search exists
    const search = await loadSearch(search_id);
    if (!search) {
      return {
        statusCode: 404,
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
      body: JSON.stringify({ 
        success: false, 
        error: error.message,
        details: 'Agent orchestration failed'
      })
    };
  }
};