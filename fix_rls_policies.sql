-- Fix Row Level Security Policies for Leadora

-- Ensure api_usage_logs RLS allows insert for dev (INSERT policies only support WITH CHECK)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'api_usage_logs' AND policyname = 'insert_api_usage_logs'
  ) THEN
    EXECUTE 'CREATE POLICY insert_api_usage_logs ON public.api_usage_logs FOR INSERT TO anon, authenticated WITH CHECK (true)';
  END IF;
END $$;

-- Ensure business_personas selectable by search_id for anon (browser) in dev
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'business_personas' AND policyname = 'select_business_personas_by_search'
  ) THEN
    EXECUTE 'CREATE POLICY select_business_personas_by_search ON public.business_personas FOR SELECT TO anon, authenticated USING (search_id IS NOT NULL)';
  END IF;
END $$;

-- Ensure decision_maker_personas selectable by search_id for anon (browser) in dev
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'decision_maker_personas' AND policyname = 'select_dm_personas_by_search'
  ) THEN
    EXECUTE 'CREATE POLICY select_dm_personas_by_search ON public.decision_maker_personas FOR SELECT TO anon, authenticated USING (search_id IS NOT NULL)';
  END IF;
END $$;

-- Ensure businesses selectable by search_id for anon (browser) in dev
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'businesses' AND policyname = 'select_businesses_by_search'
  ) THEN
    EXECUTE 'CREATE POLICY select_businesses_by_search ON public.businesses FOR SELECT TO anon, authenticated USING (search_id IS NOT NULL)';
  END IF;
END $$;

-- 1. Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can only see their own searches" ON user_searches;
DROP POLICY IF EXISTS "Users can only create their own searches" ON user_searches;
DROP POLICY IF EXISTS "Users can only update their own searches" ON user_searches;

-- 2. Create permissive policies for user_searches table
CREATE POLICY "Allow all operations for authenticated users" ON user_searches
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 3. Also fix other related tables
DROP POLICY IF EXISTS "Users can only see their own business personas" ON business_personas;
CREATE POLICY "Allow all operations for business_personas" ON business_personas
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can only see their own businesses" ON businesses;
CREATE POLICY "Allow all operations for businesses" ON businesses
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can only see their own dm personas" ON decision_maker_personas;
CREATE POLICY "Allow all operations for dm_personas" ON decision_maker_personas
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can only see their own decision makers" ON decision_makers;
CREATE POLICY "Allow all operations for decision_makers" ON decision_makers
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can only see their own market insights" ON market_insights;
CREATE POLICY "Allow all operations for market_insights" ON market_insights
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can only see their own email campaigns" ON email_campaigns;
CREATE POLICY "Allow all operations for email_campaigns" ON email_campaigns
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

-- 4. Ensure API usage logs are accessible
DROP POLICY IF EXISTS "API usage logs policy" ON api_usage_logs;
CREATE POLICY "Allow all operations for api_usage_logs" ON api_usage_logs
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

-- 5. Grant necessary permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;