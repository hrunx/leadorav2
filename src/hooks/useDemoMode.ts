import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function useDemoMode() {
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkDemoMode = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          setIsDemoMode(false);
          setLoading(false);
          return;
        }

        // Check if user is the demo user or marked as demo user
        const { data: profile } = await supabase
          .from('app_users')
          .select('is_demo_user')
          .eq('id', user.id)
          .single();

        setIsDemoMode(profile?.is_demo_user || false);
      } catch (error) {
        console.error('Error checking demo mode:', error);
        setIsDemoMode(false);
      } finally {
        setLoading(false);
      }
    };

    checkDemoMode();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      checkDemoMode();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const enterDemoMode = async (userEmail: string) => {
    try {
      await supabase.rpc('enter_demo_mode', { user_email: userEmail });
      setIsDemoMode(true);
    } catch (error) {
      console.error('Error entering demo mode:', error);
    }
  };

  const exitDemoMode = async (userEmail: string) => {
    try {
      await supabase.rpc('exit_demo_mode', { user_email: userEmail });
      setIsDemoMode(false);
    } catch (error) {
      console.error('Error exiting demo mode:', error);
    }
  };

  const isDemoUser = (userId?: string) => {
    return userId === '00000000-0000-0000-0000-000000000001';
  };

  return {
    isDemoMode,
    loading,
    enterDemoMode,
    exitDemoMode,
    isDemoUser
  };
}