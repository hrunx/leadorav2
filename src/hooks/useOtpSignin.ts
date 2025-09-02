import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { getNetlifyFunctionsBaseUrl } from '../utils/baseUrl';

export function useOtpSignin() {
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'creds' | 'otp' | 'done'>('creds');
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');

  async function signInWithPassword(input: { email: string; password: string }) {
    setLoading(true);
    setError(null);
    
    try {
      // Request OTP for this user without signing in first (unified flow)
      const base = getNetlifyFunctionsBaseUrl();
      const res = await fetch(`${base}/.netlify/functions/auth-request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.email, purpose: 'signin' })
      });
      
      const j = await res.json();
      if (!res.ok || !j.success) {
        throw new Error(j.error || 'Failed to send code');
      }
      
      setEmail(input.email);
      setPhase('otp');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function verify(code: string, password: string) {
    setLoading(true);
    setError(null);
    
    try {
      const base = getNetlifyFunctionsBaseUrl();
      const res = await fetch(`${base}/.netlify/functions/auth-verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose: 'signin', code })
      });
      
      const j = await res.json();
      if (!res.ok || !j.success) {
        throw new Error(j.error || 'Invalid code');
      }

      // OTP verified, now actually sign in
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      
      setPhase('done');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const reset = () => {
    setPhase('creds');
    setError(null);
    setLoading(false);
    setEmail('');
  };

  return { loading, phase, error, signInWithPassword, verify, reset };
}