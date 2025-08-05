/*
  # Fix Agent Schema Issues
  
  1. Make nullable fields that may not be available from Serper
  2. Add unique indexes for deduplication
  3. Add progress tracking to user_searches
  4. Make decision_makers.email nullable
*/

-- Make business fields nullable that Serper may not provide
ALTER TABLE businesses 
  ALTER COLUMN city DROP NOT NULL,
  ALTER COLUMN size DROP NOT NULL,
  ALTER COLUMN revenue DROP NOT NULL;

-- Make decision_makers.email nullable since LinkedIn searches rarely yield emails
ALTER TABLE decision_makers 
  ALTER COLUMN email DROP NOT NULL;

-- Add progress tracking to user_searches
ALTER TABLE user_searches 
  ADD COLUMN IF NOT EXISTS progress_pct integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_phase text DEFAULT 'pending';

-- Add unique indexes for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS uniq_business_per_search
  ON businesses (search_id, lower(name));

CREATE UNIQUE INDEX IF NOT EXISTS uniq_dm_per_search
  ON decision_makers (search_id, lower(name), lower(company));

-- Add index for progress tracking queries
CREATE INDEX IF NOT EXISTS idx_user_searches_status_progress 
  ON user_searches(status, progress_pct);