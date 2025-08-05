-- =====================================================
-- LEADORA DATABASE ENHANCEMENT FOR LLM MEMORY SYSTEM
-- =====================================================

-- 1. FIX MARKET_INSIGHTS TABLE - Add missing columns
ALTER TABLE market_insights 
ADD COLUMN IF NOT EXISTS sources jsonb DEFAULT '[]',
ADD COLUMN IF NOT EXISTS analysis_summary text DEFAULT '',
ADD COLUMN IF NOT EXISTS research_methodology text DEFAULT '',
ADD COLUMN IF NOT EXISTS raw_analysis text DEFAULT '';

-- 2. FIX BUSINESSES TABLE - Add missing ID column and enhance data
ALTER TABLE businesses 
ADD COLUMN IF NOT EXISTS id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS email text DEFAULT '',
ADD COLUMN IF NOT EXISTS phone text DEFAULT '',
ADD COLUMN IF NOT EXISTS website text DEFAULT '',
ADD COLUMN IF NOT EXISTS address text DEFAULT '',
ADD COLUMN IF NOT EXISTS linkedin text DEFAULT '',
ADD COLUMN IF NOT EXISTS analysis_data jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS contact_verified boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS last_updated timestamptz DEFAULT now();

-- 3. ENHANCE USER_SEARCHES TABLE - Add progress tracking and metadata
ALTER TABLE user_searches 
ADD COLUMN IF NOT EXISTS progress_pct integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_phase text DEFAULT 'starting',
ADD COLUMN IF NOT EXISTS agent_metadata jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS error_log jsonb DEFAULT '[]',
ADD COLUMN IF NOT EXISTS total_businesses_found integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_decision_makers_found integer DEFAULT 0;

-- Update status constraint to include more states
ALTER TABLE user_searches 
DROP CONSTRAINT IF EXISTS user_searches_status_check;

ALTER TABLE user_searches 
ADD CONSTRAINT user_searches_status_check 
CHECK (status IN ('in_progress', 'completed', 'failed', 'cancelled'));

-- 4. ADD DECISION_MAKERS MISSING COLUMNS
ALTER TABLE decision_makers 
ADD COLUMN IF NOT EXISTS match_score integer DEFAULT 75,
ADD COLUMN IF NOT EXISTS analysis_data jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS contact_verified boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS last_updated timestamptz DEFAULT now();

-- 5. CREATE API_USAGE_LOGS TABLE for complete tracking
CREATE TABLE IF NOT EXISTS api_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  search_id uuid REFERENCES user_searches(id) ON DELETE CASCADE,
  provider text NOT NULL, -- 'openai', 'deepseek', 'gemini', 'serper'
  endpoint text,
  status integer DEFAULT 200,
  ms integer DEFAULT 0,
  tokens integer DEFAULT 0,
  cost_usd decimal(10,6) DEFAULT 0,
  request jsonb DEFAULT '{}',
  response jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- 6. CREATE SEARCH_ANALYTICS TABLE for LLM memory
CREATE TABLE IF NOT EXISTS search_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid REFERENCES user_searches(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Performance metrics
  total_execution_time_ms integer DEFAULT 0,
  agent_performance jsonb DEFAULT '{}', -- timing for each agent
  
  -- Quality metrics
  data_quality_score integer DEFAULT 0, -- 0-100
  persona_match_accuracy integer DEFAULT 0, -- 0-100
  business_data_completeness integer DEFAULT 0, -- 0-100
  
  -- Search effectiveness
  conversion_metrics jsonb DEFAULT '{}',
  user_satisfaction integer DEFAULT 0, -- 1-5 rating
  
  -- LLM usage statistics
  total_llm_calls integer DEFAULT 0,
  total_tokens_used integer DEFAULT 0,
  total_cost_usd decimal(10,6) DEFAULT 0,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 7. CREATE RESPONSE_CACHE TABLE for faster responses
CREATE TABLE IF NOT EXISTS response_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text UNIQUE NOT NULL,
  cache_type text NOT NULL, -- 'serper_places', 'linkedin_search', 'market_analysis'
  query_hash text NOT NULL,
  response_data jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  hit_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  last_accessed timestamptz DEFAULT now()
);

-- Enable RLS on response_cache
ALTER TABLE response_cache ENABLE ROW LEVEL SECURITY;

-- 8. ENHANCE BUSINESS_PERSONAS TABLE
ALTER TABLE business_personas 
ADD COLUMN IF NOT EXISTS search_criteria jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS generated_by text DEFAULT 'agent',
ADD COLUMN IF NOT EXISTS quality_score integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_updated timestamptz DEFAULT now();

-- 9. ENHANCE DECISION_MAKER_PERSONAS TABLE  
ALTER TABLE decision_maker_personas 
ADD COLUMN IF NOT EXISTS search_criteria jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS generated_by text DEFAULT 'agent', 
ADD COLUMN IF NOT EXISTS quality_score integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_updated timestamptz DEFAULT now();

-- 10. CREATE AGENT_EXECUTION_LOG TABLE for debugging
CREATE TABLE IF NOT EXISTS agent_execution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid REFERENCES user_searches(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  agent_name text NOT NULL,
  execution_order integer NOT NULL,
  status text NOT NULL, -- 'started', 'completed', 'failed', 'timeout'
  start_time timestamptz DEFAULT now(),
  end_time timestamptz,
  duration_ms integer,
  input_data jsonb DEFAULT '{}',
  output_data jsonb DEFAULT '{}',
  error_details jsonb DEFAULT '{}',
  memory_usage_mb integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Search performance indexes
CREATE INDEX IF NOT EXISTS idx_user_searches_user_id ON user_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_user_searches_status ON user_searches(status);
CREATE INDEX IF NOT EXISTS idx_user_searches_created_at ON user_searches(created_at);

-- Business data indexes
CREATE INDEX IF NOT EXISTS idx_businesses_search_id ON businesses(search_id);
CREATE INDEX IF NOT EXISTS idx_businesses_persona_id ON businesses(persona_id);
CREATE INDEX IF NOT EXISTS idx_businesses_country ON businesses(country);
CREATE INDEX IF NOT EXISTS idx_businesses_industry ON businesses(industry);

-- Decision maker indexes
CREATE INDEX IF NOT EXISTS idx_decision_makers_search_id ON decision_makers(search_id);
CREATE INDEX IF NOT EXISTS idx_decision_makers_persona_id ON decision_makers(persona_id);
CREATE INDEX IF NOT EXISTS idx_decision_makers_company ON decision_makers(company);

-- Persona indexes
CREATE INDEX IF NOT EXISTS idx_business_personas_search_id ON business_personas(search_id);
CREATE INDEX IF NOT EXISTS idx_dm_personas_search_id ON decision_maker_personas(search_id);

-- API usage indexes
CREATE INDEX IF NOT EXISTS idx_api_usage_search_id ON api_usage_logs(search_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_provider ON api_usage_logs(provider);
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON api_usage_logs(created_at);

-- Cache indexes
CREATE INDEX IF NOT EXISTS idx_response_cache_key ON response_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_response_cache_type ON response_cache(cache_type);
CREATE INDEX IF NOT EXISTS idx_response_cache_expires ON response_cache(expires_at);

-- Agent execution indexes
CREATE INDEX IF NOT EXISTS idx_agent_execution_search_id ON agent_execution_log(search_id);
CREATE INDEX IF NOT EXISTS idx_agent_execution_agent_name ON agent_execution_log(agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_execution_status ON agent_execution_log(status);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

-- Enable RLS on new tables
ALTER TABLE IF EXISTS api_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS search_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS agent_execution_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies for new tables
CREATE POLICY "Users can view their own API usage" ON api_usage_logs 
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own search analytics" ON search_analytics 
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view relevant cache data" ON response_cache 
  FOR SELECT USING (true); -- Cache is shared but read-only for users

CREATE POLICY "Users can view their own agent execution logs" ON agent_execution_log 
  FOR ALL USING (auth.uid() = user_id);

-- =====================================================
-- FUNCTIONS FOR LLM MEMORY SYSTEM
-- =====================================================

-- Function to get complete search context for LLM
CREATE OR REPLACE FUNCTION get_search_context(search_uuid uuid)
RETURNS jsonb AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'search', (SELECT to_jsonb(s) FROM user_searches s WHERE s.id = search_uuid),
    'business_personas', (SELECT jsonb_agg(to_jsonb(bp)) FROM business_personas bp WHERE bp.search_id = search_uuid),
    'businesses', (SELECT jsonb_agg(to_jsonb(b)) FROM businesses b WHERE b.search_id = search_uuid),
    'dm_personas', (SELECT jsonb_agg(to_jsonb(dmp)) FROM decision_maker_personas dmp WHERE dmp.search_id = search_uuid),
    'decision_makers', (SELECT jsonb_agg(to_jsonb(dm)) FROM decision_makers dm WHERE dm.search_id = search_uuid),
    'market_insights', (SELECT to_jsonb(mi) FROM market_insights mi WHERE mi.search_id = search_uuid),
    'api_usage', (SELECT jsonb_agg(to_jsonb(au)) FROM api_usage_logs au WHERE au.search_id = search_uuid),
    'execution_log', (SELECT jsonb_agg(to_jsonb(ae)) FROM agent_execution_log ae WHERE ae.search_id = search_uuid)
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update search progress with metadata
CREATE OR REPLACE FUNCTION update_search_progress_with_metadata(
  search_uuid uuid,
  progress integer,
  phase text,
  metadata jsonb DEFAULT '{}'
)
RETURNS void AS $$
BEGIN
  UPDATE user_searches 
  SET 
    progress_pct = progress,
    current_phase = phase,
    agent_metadata = agent_metadata || metadata,
    updated_at = now()
  WHERE id = search_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- SAMPLE QUERIES FOR TESTING
-- =====================================================

-- Test the new schema
-- SELECT get_search_context('your-search-id-here');
-- SELECT * FROM api_usage_logs WHERE search_id = 'your-search-id-here';
-- SELECT * FROM agent_execution_log WHERE search_id = 'your-search-id-here' ORDER BY execution_order;

COMMIT;