-- =====================================================
-- STEP-BY-STEP DATABASE FIXES FOR LEADORA
-- Execute these one at a time if there are issues
-- =====================================================

-- STEP 1: Fix market_insights table (CRITICAL for market research)
ALTER TABLE market_insights 
ADD COLUMN IF NOT EXISTS sources jsonb DEFAULT '[]';

ALTER TABLE market_insights 
ADD COLUMN IF NOT EXISTS analysis_summary text DEFAULT '';

ALTER TABLE market_insights 
ADD COLUMN IF NOT EXISTS research_methodology text DEFAULT '';

-- STEP 2: Fix businesses table (missing ID column)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'businesses' AND column_name = 'id') THEN
        ALTER TABLE businesses ADD COLUMN id uuid PRIMARY KEY DEFAULT gen_random_uuid();
    END IF;
END $$;

ALTER TABLE businesses 
ADD COLUMN IF NOT EXISTS email text DEFAULT '',
ADD COLUMN IF NOT EXISTS phone text DEFAULT '',
ADD COLUMN IF NOT EXISTS website text DEFAULT '',
ADD COLUMN IF NOT EXISTS address text DEFAULT '';

-- STEP 3: Fix user_searches table (progress tracking)
ALTER TABLE user_searches 
ADD COLUMN IF NOT EXISTS progress_pct integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_phase text DEFAULT 'starting';

-- Update status constraint
ALTER TABLE user_searches DROP CONSTRAINT IF EXISTS user_searches_status_check;
ALTER TABLE user_searches ADD CONSTRAINT user_searches_status_check 
CHECK (status IN ('in_progress', 'completed', 'failed', 'cancelled'));

-- STEP 4: Create api_usage_logs table (if not exists)
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

-- STEP 5: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_searches_user_id ON user_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_businesses_search_id ON businesses(search_id);
CREATE INDEX IF NOT EXISTS idx_decision_makers_search_id ON decision_makers(search_id);
CREATE INDEX IF NOT EXISTS idx_business_personas_search_id ON business_personas(search_id);
CREATE INDEX IF NOT EXISTS idx_dm_personas_search_id ON decision_maker_personas(search_id);

-- STEP 6: Add missing match_score to decision_makers
ALTER TABLE decision_makers 
ADD COLUMN IF NOT EXISTS match_score integer DEFAULT 75;

COMMIT;