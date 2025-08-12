import { Handler } from '@netlify/functions';
import logger from '../../src/lib/logger';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;

export const handler: Handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    const { 
      user_id, 
      provider, 
      plan, 
      status, 
      period_start, 
      period_end, 
      trial_end, 
      meta
    } = JSON.parse(event.body || '{}');

    if (!user_id || !provider || !plan || !status) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: 'Missing required fields: user_id, provider, plan, status' }) 
      };
    }

    // Validate plan options
    const validPlans = ['free', 'starter', 'pro', 'enterprise'];
    const validStatuses = ['incomplete', 'trialing', 'active', 'past_due', 'canceled', 'paused'];
    const validProviders = ['stripe', 'paddle', 'manual'];

    if (!validPlans.includes(plan)) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: `Invalid plan. Must be one of: ${validPlans.join(', ')}` }) 
      };
    }

    if (!validStatuses.includes(status)) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }) 
      };
    }

    if (!validProviders.includes(provider)) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` }) 
      };
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { 
      auth: { persistSession: false } 
    });

    const { error } = await supa.rpc('set_user_subscription', {
      p_user_id: user_id,
      p_provider: provider,
      p_plan: plan,
      p_status: status,
      p_period_start: period_start ? new Date(period_start).toISOString() : null,
      p_period_end: period_end ? new Date(period_end).toISOString() : null,
      p_trial_end: trial_end ? new Date(trial_end).toISOString() : null,
      p_meta: meta ?? {}
    });

    if (error) throw error;

    logger.info('Subscription updated', { user_id, plan, status });
    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ success: true, message: 'Subscription updated successfully' }) 
    };

  } catch (e: any) {
    logger.error('Subscription update error', { error: e });
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: e.message }) 
    };
  }
};