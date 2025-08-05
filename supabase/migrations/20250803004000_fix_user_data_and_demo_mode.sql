/*
  # Fix User Data Population and Add Demo Mode Support
  
  1. Fix trigger to read user_metadata correctly
  2. Add demo mode detection
  3. Add user role field to app_users
  4. Create demo user management
*/

-- Fix the trigger to read user_metadata correctly
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.app_users (id, email, full_name, company, country, phone)
  VALUES (
    new.id, 
    new.email, 
    COALESCE(new.user_metadata->>'firstName','') || ' ' || COALESCE(new.user_metadata->>'lastName',''),
    COALESCE(new.user_metadata->>'company',''),
    COALESCE(new.user_metadata->>'country',''),
    COALESCE(new.user_metadata->>'phone','')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END$$;

-- Add demo user field to app_users table
ALTER TABLE public.app_users 
ADD COLUMN IF NOT EXISTS is_demo_user boolean NOT NULL DEFAULT false;

-- Create index for demo users
CREATE INDEX IF NOT EXISTS idx_app_users_demo ON public.app_users (is_demo_user);

-- Create or update the demo user (special fixed UUID)
INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'demo@leadora.com',
  crypt('demo-password-not-accessible', gen_salt('bf')),
  now(),
  now(),
  now(),
  '',
  '',
  '',
  ''
) ON CONFLICT (id) DO NOTHING;

-- Create demo user profile
INSERT INTO public.app_users (
  id,
  email,
  full_name,
  company,
  country,
  phone,
  is_demo_user,
  role
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'demo@leadora.com',
  'Demo User',
  'Demo Company',
  'Demo Country',
  '+1-000-000-0000',
  true,
  'user'
) ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  company = EXCLUDED.company,
  country = EXCLUDED.country,
  phone = EXCLUDED.phone,
  is_demo_user = EXCLUDED.is_demo_user;

-- Create demo subscription
INSERT INTO public.subscriptions (
  user_id,
  provider,
  plan,
  status,
  seats
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'manual',
  'demo',
  'active',
  1
) ON CONFLICT DO NOTHING;

-- Update subscription plan enum to include demo
ALTER TABLE public.subscriptions 
DROP CONSTRAINT IF EXISTS subscriptions_plan_check;

ALTER TABLE public.subscriptions 
ADD CONSTRAINT subscriptions_plan_check 
CHECK (plan = ANY (ARRAY['free'::text, 'starter'::text, 'pro'::text, 'enterprise'::text, 'demo'::text]));

-- Create function to populate demo data for demo user only
CREATE OR REPLACE FUNCTION public.populate_demo_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  demo_user_id uuid := '00000000-0000-0000-0000-000000000001';
  demo_search_id uuid;
BEGIN
  -- Check if demo data already exists
  IF EXISTS (SELECT 1 FROM user_searches WHERE user_id = demo_user_id) THEN
    RETURN;
  END IF;

  -- Create demo search
  INSERT INTO user_searches (
    id,
    user_id,
    search_type,
    product_service,
    industries,
    countries,
    status,
    phase,
    progress_pct
  ) VALUES (
    gen_random_uuid(),
    demo_user_id,
    'customer',
    'CRM Software',
    ARRAY['Technology', 'SaaS'],
    ARRAY['United States', 'Canada'],
    'completed',
    'completed',
    100
  ) RETURNING id INTO demo_search_id;

  -- Insert demo business personas
  INSERT INTO business_personas (search_id, user_id, title, rank, match_score, demographics, characteristics, behaviors, market_potential, locations) VALUES
  (demo_search_id, demo_user_id, 'Tech-Forward SMBs', 1, 95, '{"size": "50-200 employees", "revenue": "$5M-$50M"}', '{"tech_adoption": "early adopter", "decision_speed": "fast"}', '{"research_heavy": true, "price_sensitive": false}', '{"market_size": "large", "growth_rate": "high"}', '["San Francisco", "Austin", "Boston"]'),
  (demo_search_id, demo_user_id, 'Growing Startups', 2, 88, '{"size": "10-50 employees", "revenue": "$1M-$10M"}', '{"agility": "high", "budget": "limited"}', '{"quick_decisions": true, "feature_focused": true}', '{"market_size": "medium", "growth_rate": "very high"}', '["Silicon Valley", "NYC", "Seattle"]'),
  (demo_search_id, demo_user_id, 'Enterprise Sales Teams', 3, 82, '{"size": "500+ employees", "revenue": "$100M+"}', '{"process_oriented": true, "compliance_focused": true}', '{"long_sales_cycles": true, "ROI_focused": true}', '{"market_size": "large", "growth_rate": "medium"}', '["Chicago", "Atlanta", "Dallas"]');

  -- Insert demo businesses
  INSERT INTO businesses (search_id, user_id, persona_id, name, industry, country, city, size, revenue, description, match_score, persona_type) VALUES
  (demo_search_id, demo_user_id, (SELECT id FROM business_personas WHERE search_id = demo_search_id AND rank = 1), 'TechFlow Solutions', 'Technology', 'United States', 'San Francisco', 'Medium', '$25M', 'B2B SaaS platform for workflow automation', 92, 'business'),
  (demo_search_id, demo_user_id, (SELECT id FROM business_personas WHERE search_id = demo_search_id AND rank = 2), 'GrowthHack Inc', 'Technology', 'United States', 'Austin', 'Small', '$5M', 'Marketing automation for growing companies', 89, 'business'),
  (demo_search_id, demo_user_id, (SELECT id FROM business_personas WHERE search_id = demo_search_id AND rank = 3), 'Enterprise Corp', 'Technology', 'United States', 'Chicago', 'Large', '$500M', 'Fortune 500 consulting and tech services', 85, 'business');

  -- Insert demo decision maker personas
  INSERT INTO decision_maker_personas (search_id, user_id, title, rank, match_score, demographics, characteristics, behaviors, market_potential) VALUES
  (demo_search_id, demo_user_id, 'VP of Sales', 1, 94, '{"seniority": "senior", "department": "sales"}', '{"quota_driven": true, "tool_savvy": true}', '{"efficiency_focused": true, "data_driven": true}', '{"influence": "high", "budget_authority": "high"}'),
  (demo_search_id, demo_user_id, 'Sales Operations Manager', 2, 87, '{"seniority": "mid", "department": "sales_ops"}', '{"process_oriented": true, "analytical": true}', '{"optimization_focused": true, "metrics_driven": true}', '{"influence": "medium", "budget_authority": "medium"}'),
  (demo_search_id, demo_user_id, 'CRO/Chief Revenue Officer', 3, 91, '{"seniority": "executive", "department": "revenue"}', '{"strategic": true, "growth_focused": true}', '{"big_picture": true, "ROI_focused": true}', '{"influence": "very high", "budget_authority": "very high"}');

  -- Insert demo decision makers
  INSERT INTO decision_makers (search_id, user_id, persona_id, name, title, level, influence, department, company, location, email, phone, linkedin, persona_type) VALUES
  (demo_search_id, demo_user_id, (SELECT id FROM decision_maker_personas WHERE search_id = demo_search_id AND rank = 1), 'Sarah Chen', 'VP of Sales', 'executive', 90, 'Sales', 'TechFlow Solutions', 'San Francisco, CA', 'sarah.chen@techflow.com', '+1-555-0101', 'linkedin.com/in/sarahchen', 'decision_maker'),
  (demo_search_id, demo_user_id, (SELECT id FROM decision_maker_personas WHERE search_id = demo_search_id AND rank = 2), 'Mike Rodriguez', 'Sales Operations Manager', 'manager', 75, 'Sales Operations', 'GrowthHack Inc', 'Austin, TX', 'mike.r@growthhack.com', '+1-555-0102', 'linkedin.com/in/mikerodriguez', 'decision_maker'),
  (demo_search_id, demo_user_id, (SELECT id FROM decision_maker_personas WHERE search_id = demo_search_id AND rank = 3), 'Jennifer Park', 'Chief Revenue Officer', 'executive', 95, 'Revenue', 'Enterprise Corp', 'Chicago, IL', 'j.park@enterprisecorp.com', '+1-555-0103', 'linkedin.com/in/jenniferpark', 'decision_maker');

  -- Insert demo market insights
  INSERT INTO market_insights (search_id, user_id, tam_data, sam_data, som_data, competitor_data, trends, opportunities) VALUES
  (demo_search_id, demo_user_id, 
   '{"total_market": "$50B", "growth_rate": "15%", "description": "Global CRM software market"}',
   '{"addressable_market": "$5B", "growth_rate": "20%", "description": "SMB CRM segment in North America"}',
   '{"obtainable_market": "$500M", "growth_rate": "25%", "description": "Tech-forward SMBs seeking advanced CRM"}',
   '[{"name": "Salesforce", "market_share": "20%", "notes": "Enterprise leader"}, {"name": "HubSpot", "market_share": "15%", "notes": "SMB favorite"}]',
   '[{"name": "AI Integration", "impact": "High", "description": "CRM systems incorporating AI for predictive analytics"}, {"name": "Mobile-First", "impact": "Medium", "description": "Increasing demand for mobile CRM solutions"}]',
   '{"summary": "Strong growth opportunity in AI-powered CRM for SMBs", "playbook": ["Focus on AI features", "Target tech-forward companies", "Emphasize ROI and efficiency"]}'
  );
END$$;

-- Populate demo data
SELECT public.populate_demo_data();

-- Create function to check if user is in demo mode
CREATE OR REPLACE FUNCTION public.is_demo_user(user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  RETURN user_id = '00000000-0000-0000-0000-000000000001'::uuid;
END$$;

-- Update RLS policies to handle demo mode
-- Users can see demo data if they're not authenticated, or their own data if authenticated
DROP POLICY IF EXISTS "users_can_view_own_searches" ON public.user_searches;
CREATE POLICY "users_can_view_own_or_demo_searches"
ON public.user_searches FOR SELECT
TO authenticated
USING (
  user_id = auth.uid() 
  OR (user_id = '00000000-0000-0000-0000-000000000001'::uuid AND public.is_demo_user(auth.uid()))
);

-- Similar policies for other tables
DROP POLICY IF EXISTS "users_can_view_own_business_personas" ON public.business_personas;
CREATE POLICY "users_can_view_own_or_demo_business_personas"
ON public.business_personas FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR (user_id = '00000000-0000-0000-0000-000000000001'::uuid AND public.is_demo_user(auth.uid()))
);

DROP POLICY IF EXISTS "users_can_view_own_businesses" ON public.businesses;
CREATE POLICY "users_can_view_own_or_demo_businesses"
ON public.businesses FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR (user_id = '00000000-0000-0000-0000-000000000001'::uuid AND public.is_demo_user(auth.uid()))
);

DROP POLICY IF EXISTS "users_can_view_own_dm_personas" ON public.decision_maker_personas;
CREATE POLICY "users_can_view_own_or_demo_dm_personas"
ON public.decision_maker_personas FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR (user_id = '00000000-0000-0000-0000-000000000001'::uuid AND public.is_demo_user(auth.uid()))
);

DROP POLICY IF EXISTS "users_can_view_own_decision_makers" ON public.decision_makers;
CREATE POLICY "users_can_view_own_or_demo_decision_makers"
ON public.decision_makers FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR (user_id = '00000000-0000-0000-0000-000000000001'::uuid AND public.is_demo_user(auth.uid()))
);

DROP POLICY IF EXISTS "users_can_view_own_market_insights" ON public.market_insights;
CREATE POLICY "users_can_view_own_or_demo_market_insights"
ON public.market_insights FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR (user_id = '00000000-0000-0000-0000-000000000001'::uuid AND public.is_demo_user(auth.uid()))
);

-- Create function to set user as demo user (for demo mode access)
CREATE OR REPLACE FUNCTION public.enter_demo_mode(user_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  target_user_id uuid;
BEGIN
  -- Find user by email
  SELECT id INTO target_user_id 
  FROM auth.users 
  WHERE email = user_email;
  
  IF target_user_id IS NOT NULL THEN
    -- Update user to demo mode temporarily
    UPDATE public.app_users 
    SET is_demo_user = true 
    WHERE id = target_user_id;
  END IF;
END$$;

-- Create function to exit demo mode
CREATE OR REPLACE FUNCTION public.exit_demo_mode(user_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  target_user_id uuid;
BEGIN
  -- Find user by email
  SELECT id INTO target_user_id 
  FROM auth.users 
  WHERE email = user_email;
  
  IF target_user_id IS NOT NULL AND target_user_id != '00000000-0000-0000-0000-000000000001'::uuid THEN
    -- Remove demo mode for regular users
    UPDATE public.app_users 
    SET is_demo_user = false 
    WHERE id = target_user_id;
  END IF;
END$$;