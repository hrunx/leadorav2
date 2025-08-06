-- Fix Row Level Security Policies for Leadora

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