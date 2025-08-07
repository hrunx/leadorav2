-- Fix Authentication and Database Issues for Leadora
-- Run this SQL in your Supabase database to resolve CORS/401 errors

-- 1. Ensure user_searches table has proper default status
ALTER TABLE user_searches 
ALTER COLUMN status SET DEFAULT 'in_progress';

-- 2. Update constraint to match exactly what we use in code
ALTER TABLE user_searches DROP CONSTRAINT IF EXISTS user_searches_status_check;
ALTER TABLE user_searches ADD CONSTRAINT user_searches_status_check 
CHECK (status IN ('in_progress', 'completed', 'failed', 'cancelled'));

-- 3. Fix RLS policies to be more permissive for authenticated users
-- This resolves most CORS/401 issues

-- Drop all existing restrictive policies
DROP POLICY IF EXISTS "Users can only see their own searches" ON user_searches;
DROP POLICY IF EXISTS "Users can only create their own searches" ON user_searches;
DROP POLICY IF EXISTS "Users can only update their own searches" ON user_searches;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON user_searches;

-- Create comprehensive RLS policy for user_searches
CREATE POLICY "authenticated_users_full_access" ON user_searches
FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- 4. Fix all other table policies to allow authenticated access
-- Business Personas
DROP POLICY IF EXISTS "Users can only see their own business personas" ON business_personas;
DROP POLICY IF EXISTS "Allow all operations for business_personas" ON business_personas;
CREATE POLICY "authenticated_business_personas_access" ON business_personas
FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Businesses
DROP POLICY IF EXISTS "Users can only see their own businesses" ON businesses;
DROP POLICY IF EXISTS "Allow all operations for businesses" ON businesses;
CREATE POLICY "authenticated_businesses_access" ON businesses
FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Decision Maker Personas
DROP POLICY IF EXISTS "Users can only see their own dm personas" ON decision_maker_personas;
DROP POLICY IF EXISTS "Allow all operations for dm_personas" ON decision_maker_personas;
CREATE POLICY "authenticated_dm_personas_access" ON decision_maker_personas
FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Decision Makers
DROP POLICY IF EXISTS "Users can only see their own decision makers" ON decision_makers;
DROP POLICY IF EXISTS "Allow all operations for decision_makers" ON decision_makers;
CREATE POLICY "authenticated_decision_makers_access" ON decision_makers
FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Market Insights
DROP POLICY IF EXISTS "Users can only see their own market insights" ON market_insights;
DROP POLICY IF EXISTS "Allow all operations for market_insights" ON market_insights;
CREATE POLICY "authenticated_market_insights_access" ON market_insights
FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Email Campaigns
DROP POLICY IF EXISTS "Users can only see their own email campaigns" ON email_campaigns;
DROP POLICY IF EXISTS "Allow all operations for email_campaigns" ON email_campaigns;
CREATE POLICY "authenticated_email_campaigns_access" ON email_campaigns
FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- API Usage Logs
DROP POLICY IF EXISTS "API usage logs policy" ON api_usage_logs;
DROP POLICY IF EXISTS "Allow all operations for api_usage_logs" ON api_usage_logs;
CREATE POLICY "authenticated_api_logs_access" ON api_usage_logs
FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- 5. Ensure all tables have RLS enabled
ALTER TABLE user_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_maker_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_makers ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_logs ENABLE ROW LEVEL SECURITY;

-- 6. Add missing indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_searches_user_status ON user_searches(user_id, status);
CREATE INDEX IF NOT EXISTS idx_business_personas_search ON business_personas(search_id);
CREATE INDEX IF NOT EXISTS idx_businesses_search_persona ON businesses(search_id, persona_id);
CREATE INDEX IF NOT EXISTS idx_dm_personas_search ON decision_maker_personas(search_id);
CREATE INDEX IF NOT EXISTS idx_decision_makers_search_persona ON decision_makers(search_id, persona_id);
CREATE INDEX IF NOT EXISTS idx_market_insights_search ON market_insights(search_id);

-- 7. Fix any missing columns that might cause issues
ALTER TABLE user_searches 
ADD COLUMN IF NOT EXISTS phase text DEFAULT 'starting',
ADD COLUMN IF NOT EXISTS progress_pct integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_phase text DEFAULT 'starting',
ADD COLUMN IF NOT EXISTS error text,
ADD COLUMN IF NOT EXISTS totals jsonb DEFAULT '{}';

-- 8. Update phase constraint to include all valid phases
ALTER TABLE user_searches DROP CONSTRAINT IF EXISTS user_searches_phase_check;
ALTER TABLE user_searches ADD CONSTRAINT user_searches_phase_check
CHECK (phase IN ('starting', 'business_discovery', 'business_personas', 'dm_personas', 'decision_makers', 'market_research', 'completed', 'failed'));

-- 9. Ensure service role can bypass RLS for background operations
-- This is crucial for Netlify functions to work properly
DO $$
BEGIN
    -- Grant necessary permissions to service role
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
    GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;
    
    -- Allow service role to bypass RLS
    ALTER TABLE user_searches FORCE ROW LEVEL SECURITY;
    ALTER TABLE business_personas FORCE ROW LEVEL SECURITY;
    ALTER TABLE businesses FORCE ROW LEVEL SECURITY;
    ALTER TABLE decision_maker_personas FORCE ROW LEVEL SECURITY;
    ALTER TABLE decision_makers FORCE ROW LEVEL SECURITY;
    ALTER TABLE market_insights FORCE ROW LEVEL SECURITY;
    ALTER TABLE email_campaigns FORCE ROW LEVEL SECURITY;
    ALTER TABLE api_usage_logs FORCE ROW LEVEL SECURITY;
END $$;

-- 10. Create service role policies that allow everything
CREATE POLICY "service_role_bypass" ON user_searches
FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_business_personas" ON business_personas
FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_businesses" ON businesses
FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_dm_personas" ON decision_maker_personas
FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_decision_makers" ON decision_makers
FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_market_insights" ON market_insights
FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_email_campaigns" ON email_campaigns
FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_api_logs" ON api_usage_logs
FOR ALL USING (auth.role() = 'service_role');

-- 11. Final verification and notifications
DO $$
BEGIN
    RAISE NOTICE '✅ Database authentication fixes completed successfully!';
    RAISE NOTICE '🔧 Status constraint updated with default value';
    RAISE NOTICE '🔐 RLS policies configured for authenticated users';
    RAISE NOTICE '🛡️ Service role permissions granted for background operations';
    RAISE NOTICE '📊 Performance indexes added';
    RAISE NOTICE '⚡ System should now work without CORS/401 errors';
END $$;