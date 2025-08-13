import { Handler } from '@netlify/functions';
import logger from '../../src/lib/logger';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;

function hashCode(code: string) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

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

    const { email, purpose, code, password, userData } = JSON.parse(event.body || '{}') as {
      email: string;
      purpose: 'signup' | 'signin';
      code: string;
      password?: string; // required for signup
      userData?: any; // additional user data for signup
    };

    if (!email || !purpose || !code) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: 'email, purpose, code required' }) 
      };
    }

    const supaAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { 
      auth: { persistSession: false } 
    });
    
    const codeHash = hashCode(code);

    // Find a valid OTP
    const { data: otps, error: qErr } = await supaAdmin
      .from('user_otps')
      .select('id, user_id, email, purpose, expires_at, consumed_at, attempts, created_at')
      .ilike('email', email)
      .eq('purpose', purpose)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(5);

    if (qErr) throw qErr;
    
    if (!otps || !otps.length) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: 'Code expired or not found.' }) 
      };
    }

    // Try match: increment attempts if mismatch
    let matchedId: string | null = null;
    for (const row of otps) {
      const { data: fullRow } = await supaAdmin
        .from('user_otps')
        .select('code_hash, attempts')
        .eq('id', row.id)
        .single();

      if (!fullRow) continue;
      if (fullRow.attempts >= 5) continue;

      if (fullRow.code_hash === codeHash) {
        matchedId = row.id;
        break;
      } else {
        await supaAdmin
          .from('user_otps')
          .update({ attempts: fullRow.attempts + 1 })
          .eq('id', row.id);
      }
    }

    if (!matchedId) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: 'Invalid code.' }) 
      };
    }

    // Mark consumed
    await supaAdmin
      .from('user_otps')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', matchedId);

    if (purpose === 'signup') {
      if (!password) {
        return { 
          statusCode: 400, 
          headers, 
          body: JSON.stringify({ error: 'password required for signup' }) 
        };
      }

      // Create the Supabase auth user with confirmed email
      const { data: created, error: createErr } = await supaAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          firstName: userData?.firstName || '',
          lastName: userData?.lastName || '',
          company: userData?.company || '',
          role: userData?.role || '',
          industry: userData?.industry || '',
          country: userData?.country || '',
          phone: userData?.phone || ''
        }
      });

      if (createErr) throw createErr;

      logger.info('User created via OTP signup', { email });
      // Generate a Supabase magic link token that the client can verify to obtain a session immediately
      const redirectTo = process.env.URL || process.env.DEPLOY_URL || 'http://localhost:8888';
      const link = await supaAdmin.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo } as any });
      return { 
        statusCode: 200, 
        headers, 
        body: JSON.stringify({ success: true, user_id: created.user?.id, email_otp: (link as any)?.email_otp || null, action_link: (link as any)?.action_link || null }) 
      };
    }

    // signin OTP success → return a magiclink OTP so client can create a Supabase session
    // If user does not exist, generateLink will implicitly prepare a signup magic link
    let emailOtp: string | null = null;
    let actionLink: string | null = null;
    try {
      const redirectTo = process.env.URL || process.env.DEPLOY_URL || 'http://localhost:8888';
      const link: any = await supaAdmin.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo } as any });
      emailOtp = link?.email_otp || null;
      actionLink = link?.action_link || null;
  } catch {
      // Fallback: attempt user creation then generate link
      try {
        await supaAdmin.auth.admin.createUser({ email, email_confirm: true });
        const link2: any = await supaAdmin.auth.admin.generateLink({ type: 'magiclink', email });
        emailOtp = link2?.email_otp || null;
        actionLink = link2?.action_link || null;
      } catch {}
    }

    logger.info('OTP signin verified', { email });
    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ success: true, email_otp: emailOtp, action_link: actionLink }) 
    };

  } catch (e: any) {
    logger.error('OTP verification error', { error: e });
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: e.message }) 
    };
  }
};