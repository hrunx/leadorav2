import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

import { isDemoUser, DEMO_USER_PROFILE } from '../constants/demo';

export interface AppUser {
  id: string;
  email: string;
  full_name: string;
  company: string;
  country: string;
  phone: string;
  role: 'user' | 'admin';
  onboarding: Record<string, any>;
  preferences: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export function useProfile() {
  const { state: authState } = useAuth();
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Demo user detection function is now imported from constants

  useEffect(() => {
    let mounted = true;

    // Check if this is a demo user first
    if (isDemoUser(authState.user?.id, authState.user?.email)) {
      const demoProfile: AppUser = DEMO_USER_PROFILE;
      
      if (mounted) {
        setProfile(demoProfile);
        setLoading(false);
        setError(null);
      }
      return;
    }

    const loadProfile = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        
        if (!user) {
          if (mounted) {
            setProfile(null);
            setLoading(false);
          }
          return;
        }

        let data, error;
        try {
          const result = await supabase
            .from('app_users')
            .select('*')
            .eq('id', user.id)
            .single();
          data = result.data;
          error = result.error;
        } catch (err: any) {
          if (err.message?.includes('Load failed') || err.message?.includes('access control')) {
            try {
              const response = await fetch(`${import.meta.env.MODE === 'development' ? 'http://localhost:8888' : window.location.origin}/.netlify/functions/user-data-proxy?table=app_users&id=${user.id}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
              });
              if (!response.ok) throw new Error(`Proxy request failed: ${response.status}`);
              const arr = await response.json();
              data = arr && arr.length > 0 ? arr[0] : null;
              error = null;
            } catch (proxyError) {
              data = null;
              error = proxyError;
            }
          } else {
            throw err;
          }
        }

        if (error) {
          // If user doesn't exist in app_users, this might be a new signup
          // The trigger should have created it, but let's handle the edge case
          if (error.code === 'PGRST116') {
      import('../lib/logger').then(({ default: logger }) => logger.warn('User profile not found, might be creating...')).catch(()=>{});
            if (mounted) {
              setProfile(null);
              setLoading(false);
            }
            return;
          }
          throw error;
        }

        if (mounted) {
          setProfile(data);
        }
      } catch (e: any) {
    import('../lib/logger').then(({ default: logger }) => logger.error('Profile loading error', { error: (e as any)?.message || e })).catch(()=>{});
        if (mounted) {
          setError(e.message);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadProfile();

    return () => {
      mounted = false;
    };
  }, [authState.user]);

  const updateProfile = async (patch: Partial<Omit<AppUser, 'id' | 'created_at' | 'updated_at'>>) => {
    setError(null);
    
    // Handle demo users
    if (isDemoUser(authState.user?.id, authState.user?.email)) {
      // For demo users, just simulate updating by updating the local state
      if (profile) {
        const updatedProfile = { ...profile, ...patch };
        setProfile(updatedProfile);
        return updatedProfile;
      }
      return null;
    }
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('app_users')
        .update(patch)
        .eq('id', user.id)
        .select()
        .single();

      if (error) throw error;

      setProfile(data);
      return data;
    } catch (e: any) {
      setError(e.message);
      throw e;
    }
  };

  const refreshProfile = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Short-circuit for demo users to avoid unnecessary network calls
      if (isDemoUser(authState.user?.id, authState.user?.email)) {
        setProfile(DEMO_USER_PROFILE);
        return DEMO_USER_PROFILE;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('app_users')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      setProfile(data);
      return data;
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  return { 
    profile, 
    loading, 
    error, 
    updateProfile, 
    refreshProfile 
  };
}