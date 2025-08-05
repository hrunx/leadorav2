import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';
const DEMO_USER_EMAIL = 'demo@leadora.com';

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

  // Demo user detection
  const isDemoUser = (userId?: string | null, userEmail?: string | null) => {
    return userId === DEMO_USER_ID || userId === 'demo-user' || userEmail === DEMO_USER_EMAIL;
  };

  useEffect(() => {
    let mounted = true;

    // Check if this is a demo user first
    if (isDemoUser(authState.user?.id, authState.user?.email)) {
      const demoProfile: AppUser = {
        id: 'demo-user',
        email: 'demo@leadora.com',
        full_name: 'Demo User',
        company: 'Demo Company Inc.',
        country: 'United States',
        phone: '+1 (555) 123-4567',
        role: 'user',
        onboarding: {},
        preferences: {},
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      };
      
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

        const { data, error } = await supabase
          .from('app_users')
          .select('*')
          .eq('id', user.id)
          .single();

        if (error) {
          // If user doesn't exist in app_users, this might be a new signup
          // The trigger should have created it, but let's handle the edge case
          if (error.code === 'PGRST116') {
            console.warn('User profile not found, might be creating...');
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
        console.error('Profile loading error:', e);
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