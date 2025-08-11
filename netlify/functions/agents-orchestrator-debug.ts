import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  }

  try {
    const { search_id, user_id } = JSON.parse(event.body || "{}");
    
    if (!search_id || !user_id) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: 'search_id and user_id are required' }) 
      };
    }

    console.log(`Starting orchestration debug for search ${search_id}, user ${user_id}`);

    // Test dynamic imports one by one
    let importResults = {};

    try {
      console.log('Testing execBusinessPersonas import...');
      const { execBusinessPersonas } = await import('../../src/orchestration/exec-business-personas.js').catch(() => import('../../src/orchestration/exec-business-personas'));
      importResults['execBusinessPersonas'] = 'success';
      console.log('✓ execBusinessPersonas imported successfully');
    } catch (e) {
      importResults['execBusinessPersonas'] = `error: ${e.message}`;
      console.error('✗ execBusinessPersonas import failed:', e);
    }

    try {
      console.log('Testing updateSearchProgress import...');
      const { updateSearchProgress } = await import('../../src/tools/db.write.js').catch(() => import('../../src/tools/db.write'));
      importResults['updateSearchProgress'] = 'success';
      await updateSearchProgress?.(search_id, 5, 'debug_test');
      console.log('✓ updateSearchProgress imported and called successfully');
    } catch (e) {
      importResults['updateSearchProgress'] = `error: ${e.message}`;
      console.error('✗ updateSearchProgress failed:', e);
    }

    // Test environment variables
    const envCheck = {
      DEEPSEEK_API_KEY: !!process.env.DEEPSEEK_API_KEY,
      SERPER_KEY: !!process.env.SERPER_KEY,
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
      VITE_SUPABASE_URL: !!process.env.VITE_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY
    };

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ 
        success: true,
        message: 'Debug completed',
        search_id,
        user_id,
        import_results: importResults,
        env_check: envCheck,
        note: 'This debug function tests each component individually'
      })
    };
  } catch (err: any) {
    console.error('Debug orchestration failed:', err);

    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ 
        success: false, 
        error: err?.message || 'Unknown error',
        stack: err?.stack,
        details: 'Debug orchestration failed'
      })
    };
  }
};