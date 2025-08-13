-- Create table for logging LinkedIn search queries to avoid duplicates
CREATE TABLE IF NOT EXISTS linkedin_query_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hash text NOT NULL UNIQUE,
  company text NOT NULL,
  query text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Periodic cleanup (run separately):
-- DELETE FROM linkedin_query_log WHERE created_at < now() - interval '30 days';
