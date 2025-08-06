import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage: window?.localStorage
    },
    global: {
      headers: {
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json'
      }
    }
  }
);

// Database types
export interface AppUser {
  id: string;
  email: string;
  full_name: string;
  company: string;
  country: string;
  phone: string;
  role: 'user' | 'admin';
  onboarding: any;
  preferences: any;
  created_at: string;
  updated_at: string;
}

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
  meta: any;
  created_at: string;
  updated_at: string;
}

export interface UserOtp {
  id: string;
  user_id: string | null;
  email: string;
  purpose: 'signup' | 'signin';
  code_hash: string;
  expires_at: string;
  consumed_at: string | null;
  attempts: number;
  ip: string | null;
  ua: string | null;
  metadata: any;
  created_at: string;
}
export interface UserSearch {
  id: string;
  user_id: string;
  search_type: 'customer' | 'supplier';
  product_service: string;
  industries: string[];
  countries: string[];
  status: 'in_progress' | 'completed';
  created_at: string;
  updated_at: string;
}

export interface BusinessPersona {
  id: string;
  search_id: string;
  user_id: string;
  title: string;
  rank: number;
  match_score: number;
  demographics: any;
  characteristics: any;
  behaviors: any;
  market_potential: any;
  locations: any[];
  created_at: string;
}

export interface Business {
  id: string;
  search_id: string;
  user_id: string;
  persona_id?: string;
  name: string;
  industry: string;
  country: string;
  city: string;
  size: string;
  revenue: string;
  description: string;
  match_score: number;
  relevant_departments: string[];
  key_products: string[];
  recent_activity: string[];
  persona_type: string;
  created_at: string;
}

export interface DecisionMakerPersona {
  id: string;
  search_id: string;
  user_id: string;
  title: string;
  rank: number;
  match_score: number;
  demographics: any;
  characteristics: any;
  behaviors: any;
  market_potential: any;
  created_at: string;
}

export interface DecisionMaker {
  id: string;
  search_id: string;
  user_id: string;
  persona_id?: string;
  name: string;
  title: string;
  level: 'executive' | 'director' | 'manager' | 'individual';
  influence: number;
  department: string;
  company: string;
  location: string;
  email: string;
  phone: string;
  linkedin: string;
  experience: string;
  communication_preference: string;
  pain_points: string[];
  motivations: string[];
  decision_factors: string[];
  persona_type: string;
  company_context: any;
  personalized_approach: any;
  created_at: string;
}

export interface MarketInsight {
  id: string;
  search_id: string;
  user_id: string;
  tam_data: any;
  sam_data: any;
  som_data: any;
  competitor_data: any[];
  trends: any[];
  opportunities: any;
  created_at: string;
  updated_at: string;
}

export interface EmailCampaign {
  id: string;
  search_id?: string;
  user_id: string;
  name: string;
  campaign_type: 'customer' | 'supplier';
  status: 'draft' | 'scheduled' | 'sent' | 'active';
  template_id?: string;
  subject: string;
  content: string;
  scheduled_date?: string;
  sent_date?: string;
  stats: {
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
  };
  created_at: string;
  updated_at: string;
}

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  user_id: string;
  recipient_type: 'business' | 'decision_maker';
  recipient_id: string;
  recipient_name: string;
  recipient_email: string;
  status: 'pending' | 'sent' | 'opened' | 'clicked' | 'replied';
  sent_at?: string;
  opened_at?: string;
  clicked_at?: string;
  replied_at?: string;
  created_at: string;
}