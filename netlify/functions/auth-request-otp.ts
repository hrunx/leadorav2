import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;
const EMAIL_API_URL = process.env.EMAIL_API_URL!;   // your gmail server api endpoint
const EMAIL_API_KEY = process.env.EMAIL_API_KEY!;   // your gmail server api key

function hashCode(code: string) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateCode() {
  // Use cryptographically secure random number generation
  const randomBytes = crypto.randomBytes(4);
  const randomNumber = randomBytes.readUInt32BE(0);
  const otp = String(100000 + (randomNumber % 900000));
  return otp.substring(0, 6); // Ensure exactly 6 digits
}

async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const res = await fetch(EMAIL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': EMAIL_API_KEY,
    },
    body: JSON.stringify({ 
      to: [to], // Convert single email to array as required by API
      subject, 
      html 
    })
  });
  
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mailer error ${res.status}: ${body}`);
  }
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

  // Validate environment variables
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !EMAIL_API_URL || !EMAIL_API_KEY) {
    console.error('Missing environment variables:', {
      SUPABASE_URL: !!SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY,
      EMAIL_API_URL: !!EMAIL_API_URL,
      EMAIL_API_KEY: !!EMAIL_API_KEY
    });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    const { email, purpose, user_id } = JSON.parse(event.body || '{}') as {
      email: string;
      purpose: 'signup' | 'signin';
      user_id?: string; // provide on sign-in
    };

    if (!email || !purpose) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: 'email & purpose required' }) 
      };
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { 
      auth: { persistSession: false } 
    });

    // Optional throttling: prevent spamming (last 60s)
    const { data: recent } = await supa
      .from('user_otps')
      .select('id, created_at')
      .eq('purpose', purpose)
      .ilike('email', email)
      .gte('created_at', new Date(Date.now() - 60_000).toISOString())
      .limit(1);

    if (recent && recent.length) {
      return { 
        statusCode: 429, 
        headers, 
        body: JSON.stringify({ error: 'Please wait before requesting another code.' }) 
      };
    }

    const code = generateCode();
    const codeHash = hashCode(code);
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString(); // 10 minutes

    const { error: insertErr } = await supa.from('user_otps').insert({
      user_id: user_id ?? null,
      email,
      purpose,
      code_hash: codeHash,
      expires_at: expiresAt,
      ip: event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || '',
      ua: event.headers['user-agent'] || ''
    });

    if (insertErr) throw insertErr;

    const subj = purpose === 'signup' ? 'Your Leadora sign-up code' : 'Your Leadora sign-in code';
    const htmlBody = `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #4F46E5;">Leadora</h1>
              <p style="color: #6B7280;">AI-Powered Lead Intelligence</p>
            </div>
            
            <div style="background: #F3F4F6; padding: 30px; border-radius: 8px; text-align: center;">
              <h2 style="color: #1F2937; margin-bottom: 20px;">Your Verification Code</h2>
              <div style="background: white; padding: 20px; border-radius: 6px; margin: 20px 0;">
                <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #4F46E5;">${code}</div>
              </div>
              <p style="color: #6B7280; margin-bottom: 10px;">This code expires in <strong>10 minutes</strong></p>
            </div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #E5E7EB;">
              <p style="color: #6B7280; font-size: 14px;">
                If you didn't request this verification code, you can safely ignore this email.
              </p>
              <p style="color: #6B7280; font-size: 14px; margin-top: 20px;">
                Best regards,<br>
                <strong>The Leadora Team</strong>
              </p>
            </div>
          </div>
        </body>
      </html>
    `;
    
    await sendEmail({ to: email, subject: subj, html: htmlBody });

    console.log(`OTP sent for ${purpose} to ${email}`);
    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ success: true }) 
    };

  } catch (e: any) {
    console.error('OTP request error:', e);
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: e.message }) 
    };
  }
};