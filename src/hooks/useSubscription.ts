import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface Subscription {
  id: string;
  user_id: string;
  provider: 'stripe' | 'paddle' | 'manual';
  plan: 'free' | 'starter' | 'pro' | 'enterprise';
  status: 'incomplete' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused';
  cancel_at_period_end: boolean;
  period_start: string | null;
  period_end: string | null;
  trial_end: string | null;
  seats: number;
  meta: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface PlanLimits {
  searches_per_month: number;
  businesses_per_search: number;
  decision_makers_per_search: number;
  email_campaigns: boolean;
  market_insights: boolean;
  export_data: boolean;
  api_access: boolean;
  priority_support: boolean;
}

const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: {
    searches_per_month: 3,
    businesses_per_search: 10,
    decision_makers_per_search: 30,
    email_campaigns: false,
    market_insights: false,
    export_data: false,
    api_access: false,
    priority_support: false,
  },
  starter: {
    searches_per_month: 25,
    businesses_per_search: 50,
    decision_makers_per_search: 150,
    email_campaigns: true,
    market_insights: true,
    export_data: true,
    api_access: false,
    priority_support: false,
  },
  pro: {
    searches_per_month: 100,
    businesses_per_search: 200,
    decision_makers_per_search: 600,
    email_campaigns: true,
    market_insights: true,
    export_data: true,
    api_access: true,
    priority_support: true,
  },
  enterprise: {
    searches_per_month: -1, // unlimited
    businesses_per_search: 500,
    decision_makers_per_search: 1500,
    email_campaigns: true,
    market_insights: true,
    export_data: true,
    api_access: true,
    priority_support: true,
  }
};

export function useSubscription() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadSubscription = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (mounted) {
            setSubscription(null);
            setLoading(false);
          }
          return;
        }

        const { data, error } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .in('status', ['active', 'trialing', 'past_due'])
          .order('created_at', { ascending: false })
          .limit(1);

        if (error) throw error;

        if (mounted) {
          setSubscription(data?.[0] ?? null);
        }
      } catch (e: any) {
        console.error('Subscription loading error:', e);
        if (mounted) {
          setError(e.message);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadSubscription();

    return () => {
      mounted = false;
    };
  }, []);

  const refreshSubscription = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .in('status', ['active', 'trialing', 'past_due'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) throw error;

      setSubscription(data?.[0] ?? null);
      return data?.[0] ?? null;
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const isFeatureAvailable = (feature: keyof PlanLimits): boolean => {
    if (!subscription) return false;
    const limits = PLAN_LIMITS[subscription.plan] || PLAN_LIMITS.free;
    return Boolean(limits[feature]);
  };

  const getUsageLimit = (feature: keyof PlanLimits): number => {
    if (!subscription) return PLAN_LIMITS.free[feature] as number;
    const limits = PLAN_LIMITS[subscription.plan] || PLAN_LIMITS.free;
    return limits[feature] as number;
  };

  const isActive = subscription?.status === 'active';
  const isTrialing = subscription?.status === 'trialing';
  const isPastDue = subscription?.status === 'past_due';
  const isValidSubscription = isActive || isTrialing;
  
  const planLimits = subscription ? 
    PLAN_LIMITS[subscription.plan] || PLAN_LIMITS.free : 
    PLAN_LIMITS.free;

  const daysUntilExpiry = subscription?.period_end ? 
    Math.ceil((new Date(subscription.period_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 
    null;

  const trialDaysLeft = subscription?.trial_end ? 
    Math.ceil((new Date(subscription.trial_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 
    null;

  return { 
    subscription, 
    loading, 
    error, 
    refreshSubscription,
    isFeatureAvailable,
    getUsageLimit,
    planLimits,
    isActive,
    isTrialing,
    isPastDue,
    isValidSubscription,
    daysUntilExpiry,
    trialDaysLeft,
    currentPlan: subscription?.plan || 'free'
  };
}