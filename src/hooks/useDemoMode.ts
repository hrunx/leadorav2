import { useState, useEffect } from 'react';
import logger from '../lib/logger';
import { supabase } from '../lib/supabase';
import { isDemoUser as isDemoUserUtil } from '../constants/demo';

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
      } catch (error: any) {
        logger.error('Error checking demo mode', { error: error?.message || String(error) });
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
    } catch (error: any) {
      logger.error('Error entering demo mode', { error: error?.message || String(error) });
    }
  };

  const exitDemoMode = async (userEmail: string) => {
    try {
      await supabase.rpc('exit_demo_mode', { user_email: userEmail });
      setIsDemoMode(false);
    } catch (error: any) {
      logger.error('Error exiting demo mode', { error: error?.message || String(error) });
    }
  };

  // Import and re-export for compatibility

  return {
    isDemoMode,
    loading,
    enterDemoMode,
    exitDemoMode,
    isDemoUser: isDemoUserUtil // Use centralized function
  };
}