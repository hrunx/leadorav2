/*
  # Create comprehensive user flow tables

  1. New Tables
    - `user_searches` - Store user search configurations
    - `business_personas` - Store generated business personas for each search
    - `businesses` - Store discovered businesses
    - `decision_maker_personas` - Store decision maker personas
    - `decision_makers` - Store individual decision makers
    - `market_insights` - Store market analysis data
    - `email_campaigns` - Store user email campaigns
    - `campaign_recipients` - Store campaign recipient relationships

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to access only their own data
*/

-- User searches table
CREATE TABLE IF NOT EXISTS user_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  search_type text NOT NULL CHECK (search_type IN ('customer', 'supplier')),
  product_service text NOT NULL,
  industries text[] DEFAULT '{}',
  countries text[] DEFAULT '{}',
  status text DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Business personas table
CREATE TABLE IF NOT EXISTS business_personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid REFERENCES user_searches(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  rank integer NOT NULL,
  match_score integer NOT NULL,
  demographics jsonb DEFAULT '{}',
  characteristics jsonb DEFAULT '{}',
  behaviors jsonb DEFAULT '{}',
  market_potential jsonb DEFAULT '{}',
  locations jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now()
);

-- Businesses table
CREATE TABLE IF NOT EXISTS businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid REFERENCES user_searches(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  persona_id uuid REFERENCES business_personas(id) ON DELETE CASCADE,
  name text NOT NULL,
  industry text NOT NULL,
  country text NOT NULL,
  city text NOT NULL,
  size text NOT NULL,
  revenue text NOT NULL,
  description text DEFAULT '',
  match_score integer NOT NULL,
  relevant_departments text[] DEFAULT '{}',
  key_products text[] DEFAULT '{}',
  recent_activity text[] DEFAULT '{}',
  persona_type text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Decision maker personas table
CREATE TABLE IF NOT EXISTS decision_maker_personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid REFERENCES user_searches(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  rank integer NOT NULL,
  match_score integer NOT NULL,
  demographics jsonb DEFAULT '{}',
  characteristics jsonb DEFAULT '{}',
  behaviors jsonb DEFAULT '{}',
  market_potential jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Decision makers table
CREATE TABLE IF NOT EXISTS decision_makers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid REFERENCES user_searches(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  persona_id uuid REFERENCES decision_maker_personas(id) ON DELETE CASCADE,
  name text NOT NULL,
  title text NOT NULL,
  level text NOT NULL CHECK (level IN ('executive', 'director', 'manager', 'individual')),
  influence integer NOT NULL,
  department text NOT NULL,
  company text NOT NULL,
  location text NOT NULL,
  email text NOT NULL,
  phone text DEFAULT '',
  linkedin text DEFAULT '',
  experience text DEFAULT '',
  communication_preference text DEFAULT '',
  pain_points text[] DEFAULT '{}',
  motivations text[] DEFAULT '{}',
  decision_factors text[] DEFAULT '{}',
  persona_type text NOT NULL,
  company_context jsonb DEFAULT '{}',
  personalized_approach jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Market insights table
CREATE TABLE IF NOT EXISTS market_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid REFERENCES user_searches(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  tam_data jsonb DEFAULT '{}',
  sam_data jsonb DEFAULT '{}',
  som_data jsonb DEFAULT '{}',
  competitor_data jsonb DEFAULT '[]',
  trends jsonb DEFAULT '[]',
  opportunities jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Email campaigns table
CREATE TABLE IF NOT EXISTS email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid REFERENCES user_searches(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  campaign_type text NOT NULL CHECK (campaign_type IN ('customer', 'supplier')),
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sent', 'active')),
  template_id text,
  subject text NOT NULL,
  content text NOT NULL,
  scheduled_date timestamptz,
  sent_date timestamptz,
  stats jsonb DEFAULT '{"sent": 0, "opened": 0, "clicked": 0, "replied": 0}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Campaign recipients table
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES email_campaigns(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  recipient_type text NOT NULL CHECK (recipient_type IN ('business', 'decision_maker')),
  recipient_id uuid NOT NULL,
  recipient_name text NOT NULL,
  recipient_email text NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'opened', 'clicked', 'replied')),
  sent_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE user_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_maker_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_makers ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can manage their own searches"
  ON user_searches
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own business personas"
  ON business_personas
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own businesses"
  ON businesses
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own decision maker personas"
  ON decision_maker_personas
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own decision makers"
  ON decision_makers
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own market insights"
  ON market_insights
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own email campaigns"
  ON email_campaigns
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own campaign recipients"
  ON campaign_recipients
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_searches_user_id ON user_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_user_searches_created_at ON user_searches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_personas_search_id ON business_personas(search_id);
CREATE INDEX IF NOT EXISTS idx_businesses_search_id ON businesses(search_id);
CREATE INDEX IF NOT EXISTS idx_decision_maker_personas_search_id ON decision_maker_personas(search_id);
CREATE INDEX IF NOT EXISTS idx_decision_makers_search_id ON decision_makers(search_id);
CREATE INDEX IF NOT EXISTS idx_market_insights_search_id ON market_insights(search_id);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_user_id ON email_campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_id ON campaign_recipients(campaign_id);