import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { getNetlifyFunctionsBaseUrl } from '../utils/baseUrl';

export function useOtpSignup() {
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'enter' | 'verify' | 'done'>('enter');
  const [error, setError] = useState<string | null>(null);

  async function request(email: string) {
    setLoading(true);
    setError(null);
    
    try {
      const base = getNetlifyFunctionsBaseUrl();
      const res = await fetch(`${base}/.netlify/functions/auth-request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose: 'signup' })
      });
      
      const j = await res.json();
      if (!res.ok || !j.success) {
        throw new Error(j.error || 'Failed to send code');
      }
      
      setStep('verify');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function verify(email: string, code: string, password: string, userData?: any) {
    setLoading(true);
    setError(null);
    
    try {
      const base = getNetlifyFunctionsBaseUrl();
      const res = await fetch(`${base}/.netlify/functions/auth-verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email, 
          purpose: 'signup', 
          code, 
          password,
          userData 
        })
      });
      
      const j = await res.json();
      if (!res.ok || !j.success) {
        throw new Error(j.error || 'Invalid code');
      }

      // Now sign in normally with the created account
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      
      setStep('done');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const reset = () => {
    setStep('enter');
    setError(null);
    setLoading(false);
  };

  return { loading, step, error, request, verify, reset };
}