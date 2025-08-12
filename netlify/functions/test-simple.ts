import type { Handler } from '@netlify/functions';
import logger from '../../src/lib/logger';

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, apikey, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  try {
  logger.info('Simple test function called');
  logger.debug('Environment check', {
      VITE_SUPABASE_URL: !!process.env.VITE_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      DEEPSEEK_API_KEY: !!process.env.DEEPSEEK_API_KEY,
      SERPER_KEY: !!process.env.SERPER_KEY,
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY
    });
    
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ 
        success: true,
        message: 'Simple test works',
        env_check: 'completed'
      })
    };
  } catch (error: any) {
  logger.error('Simple test failed', { error });
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