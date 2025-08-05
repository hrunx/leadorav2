import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  try {
    console.log('Simple test function called');
    console.log('Environment check:', {
      VITE_SUPABASE_URL: !!process.env.VITE_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      DEEPSEEK_API_KEY: !!process.env.DEEPSEEK_API_KEY,
      SERPER_KEY: !!process.env.SERPER_KEY,
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY
    });
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true,
        message: 'Simple test works',
        env_check: 'completed'
      })
    };
  } catch (error: any) {
    console.error('Simple test failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        success: false,
        error: error.message
      })
    };
  }
};