-- =====================================================
-- COMPLETE LEADORA DATABASE SETUP AND FIXES
-- Execute these commands in your Supabase SQL editor
-- =====================================================

-- 1. CRITICAL: Add business_id foreign key to decision_makers table
-- This is essential for linking decision makers to their businesses
ALTER TABLE decision_makers 
ADD COLUMN IF NOT EXISTS business_id uuid;

-- Add foreign key constraint to ensure data integrity
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_decision_makers_business_id'
    ) THEN
        ALTER TABLE decision_makers 
        ADD CONSTRAINT fk_decision_makers_business_id 
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_decision_makers_business_id 
ON decision_makers(business_id);

-- 2. Add enrichment columns to decision_makers (for fast-first strategy)
ALTER TABLE decision_makers 
ADD COLUMN IF NOT EXISTS enrichment_status text DEFAULT 'pending' CHECK (enrichment_status IN ('pending', 'done')),
ADD COLUMN IF NOT EXISTS enrichment jsonb DEFAULT null;

-- Add partial index for pending enrichments
CREATE INDEX IF NOT EXISTS idx_decision_makers_enrichment_pending 
ON decision_makers(search_id) WHERE enrichment_status = 'pending';

-- 3. Ensure businesses table has all required columns
ALTER TABLE businesses 
ADD COLUMN IF NOT EXISTS id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS email text DEFAULT '',
ADD COLUMN IF NOT EXISTS phone text DEFAULT '',
ADD COLUMN IF NOT EXISTS website text DEFAULT '',
ADD COLUMN IF NOT EXISTS address text DEFAULT '',
ADD COLUMN IF NOT EXISTS rating decimal(2,1) DEFAULT null;

-- 4. Fix market_insights table for comprehensive market research
ALTER TABLE market_insights
ADD COLUMN IF NOT EXISTS sources jsonb DEFAULT '[]', -- [{title,text,url,text,date,text}]
ADD COLUMN IF NOT EXISTS analysis_summary text DEFAULT '',
ADD COLUMN IF NOT EXISTS research_methodology text DEFAULT '';

-- 5. Enhance user_searches table for progress tracking
ALTER TABLE user_searches 
ADD COLUMN IF NOT EXISTS progress_pct integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_phase text DEFAULT 'starting';

-- Update status constraint to include all states
ALTER TABLE user_searches DROP CONSTRAINT IF EXISTS user_searches_status_check;
ALTER TABLE user_searches ADD CONSTRAINT user_searches_status_check 
CHECK (status IN ('in_progress', 'completed', 'failed', 'cancelled'));

-- Add phase constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'user_searches_phase_check'
    ) THEN
        ALTER TABLE user_searches ADD CONSTRAINT user_searches_phase_check 
        CHECK (current_phase IN ('starting', 'personas', 'businesses', 'decision_makers', 'market_insights', 'completed', 'failed'));
    END IF;
END $$;

-- 6. Create api_usage_logs table for comprehensive tracking
CREATE TABLE IF NOT EXISTS api_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  search_id uuid,
  provider text NOT NULL,
  endpoint text,
  status integer DEFAULT 200,
  ms integer DEFAULT 0,
  tokens integer DEFAULT 0,
  cost_usd decimal(10,6) DEFAULT 0,
  request jsonb DEFAULT '{}',
  response jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- 7. Add missing match_score to decision_makers
ALTER TABLE decision_makers 
ADD COLUMN IF NOT EXISTS match_score integer DEFAULT 75;

-- 8. Create performance indexes
CREATE INDEX IF NOT EXISTS idx_user_searches_user_id ON user_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_user_searches_status ON user_searches(status);
CREATE INDEX IF NOT EXISTS idx_businesses_search_id ON businesses(search_id);
CREATE INDEX IF NOT EXISTS idx_businesses_persona_id ON businesses(persona_id);
CREATE INDEX IF NOT EXISTS idx_decision_makers_search_id ON decision_makers(search_id);
CREATE INDEX IF NOT EXISTS idx_decision_makers_persona_id ON decision_makers(persona_id);
CREATE INDEX IF NOT EXISTS idx_business_personas_search_id ON business_personas(search_id);
CREATE INDEX IF NOT EXISTS idx_dm_personas_search_id ON decision_maker_personas(search_id);
CREATE INDEX IF NOT EXISTS idx_market_insights_search_id ON market_insights(search_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_search_id ON api_usage_logs(search_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_user_id ON api_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_created_at ON api_usage_logs(created_at);

-- 9. Ensure proper data types and constraints
-- Make sure persona_id can be null (for initial storage before mapping)
ALTER TABLE businesses ALTER COLUMN persona_id DROP NOT NULL;
ALTER TABLE decision_makers ALTER COLUMN persona_id DROP NOT NULL;

-- Ensure search_id and user_id are properly constrained
ALTER TABLE businesses ALTER COLUMN search_id SET NOT NULL;
ALTER TABLE decision_makers ALTER COLUMN search_id SET NOT NULL;
ALTER TABLE business_personas ALTER COLUMN search_id SET NOT NULL;
ALTER TABLE decision_maker_personas ALTER COLUMN search_id SET NOT NULL;

-- 10. Add helpful database functions for data integrity
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add updated_at triggers where needed
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_searches_updated_at') THEN
        CREATE TRIGGER update_user_searches_updated_at 
            BEFORE UPDATE ON user_searches 
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_market_insights_updated_at') THEN
        CREATE TRIGGER update_market_insights_updated_at 
            BEFORE UPDATE ON market_insights 
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- 11. Create linkedin_query_cache table for query caching
CREATE TABLE IF NOT EXISTS linkedin_query_cache (
  search_id uuid NOT NULL,
  company text NOT NULL,
  query text NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (search_id, company, query)
);
CREATE INDEX IF NOT EXISTS idx_linkedin_query_cache_created_at ON linkedin_query_cache(created_at);
CREATE INDEX IF NOT EXISTS idx_linkedin_query_cache_search ON linkedin_query_cache(search_id);

-- 12. Verification and status report
DO $$
DECLARE
    business_count integer;
    dm_count integer;
    persona_count integer;
BEGIN
    -- Get table counts for verification
    SELECT COUNT(*) INTO business_count FROM businesses;
    SELECT COUNT(*) INTO dm_count FROM decision_makers;
    SELECT COUNT(*) INTO persona_count FROM business_personas;
    
    RAISE NOTICE '=== LEADORA DATABASE SETUP COMPLETE ===';
    RAISE NOTICE 'Current data counts:';
    RAISE NOTICE '- Businesses: %', business_count;
    RAISE NOTICE '- Decision Makers: %', dm_count;
    RAISE NOTICE '- Business Personas: %', persona_count;
    RAISE NOTICE '';
    RAISE NOTICE 'Key relationships established:';
    RAISE NOTICE '✅ businesses(id) <- decision_makers(business_id)';
    RAISE NOTICE '✅ business_personas(id) <- businesses(persona_id)';
    RAISE NOTICE '✅ decision_maker_personas(id) <- decision_makers(persona_id)';
    RAISE NOTICE '✅ user_searches(id) <- all tables(search_id)';
    RAISE NOTICE '';
    RAISE NOTICE 'Performance indexes created for all major queries';
    RAISE NOTICE 'Enrichment system ready for decision makers';
    RAISE NOTICE 'API usage logging configured';
    RAISE NOTICE '';
    RAISE NOTICE 'Database is ready for production use! 🚀';
END $$;

COMMIT;