-- Fix proxy authentication issues by making RLS policies more permissive
-- This allows the frontend to access data via proxy without authentication

-- Update RLS policies to allow anon access for data retrieval
DROP POLICY IF EXISTS businesses_access_policy ON public.businesses;
CREATE POLICY businesses_access_policy ON public.businesses
  FOR ALL USING (true);

DROP POLICY IF EXISTS business_personas_access_policy ON public.business_personas;
CREATE POLICY business_personas_access_policy ON public.business_personas
  FOR ALL USING (true);

DROP POLICY IF EXISTS decision_makers_access_policy ON public.decision_makers;
CREATE POLICY decision_makers_access_policy ON public.decision_makers
  FOR ALL USING (true);

DROP POLICY IF EXISTS decision_maker_personas_access_policy ON public.decision_maker_personas;
CREATE POLICY decision_maker_personas_access_policy ON public.decision_maker_personas
  FOR ALL USING (true);

DROP POLICY IF EXISTS market_insights_access_policy ON public.market_insights;
CREATE POLICY market_insights_access_policy ON public.market_insights
  FOR ALL USING (true);

DROP POLICY IF EXISTS user_searches_access_policy ON public.user_searches;
CREATE POLICY user_searches_access_policy ON public.user_searches
  FOR ALL USING (true);

-- Grant necessary permissions to anon role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.businesses TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_personas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.decision_makers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.decision_maker_personas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_insights TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_searches TO anon;

-- Also ensure service_role has access
GRANT SELECT, INSERT, UPDATE, DELETE ON public.businesses TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_personas TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.decision_makers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.decision_maker_personas TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_insights TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_searches TO service_role;

-- Update proxy function to be more permissive (remove auth requirement for GET requests)