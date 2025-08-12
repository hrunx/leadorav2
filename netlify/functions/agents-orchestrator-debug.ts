import type { Handler } from '@netlify/functions';
import logger from '../../src/lib/logger';

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

    logger.info('Starting orchestration debug', { search_id, user_id });

    // Test dynamic imports one by one
    const importResults: Record<string, string> = {};

    try {
      logger.info('Testing execBusinessPersonas import...');
      await import('../../src/orchestration/exec-business-personas.js').catch(() => import('../../src/orchestration/exec-business-personas'));
      importResults['execBusinessPersonas'] = 'success';
      logger.info('✓ execBusinessPersonas imported successfully');
    } catch (e) {
      importResults['execBusinessPersonas'] = `error: ${e.message}`;
      logger.error('✗ execBusinessPersonas import failed', { error: e });
    }

    try {
      logger.info('Testing updateSearchProgress import...');
      const { updateSearchProgress } = await import('../../src/tools/db.write.js').catch(() => import('../../src/tools/db.write'));
      importResults['updateSearchProgress'] = 'success';
      await updateSearchProgress?.(search_id, 5, 'debug_test');
      logger.info('✓ updateSearchProgress imported and called successfully');
    } catch (e) {
      importResults['updateSearchProgress'] = `error: ${e.message}`;
      logger.error('✗ updateSearchProgress failed', { error: e });
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
  logger.error('Debug orchestration failed', { error: err });

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