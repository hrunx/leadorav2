/*
  # OTP Authentication System
  
  1. Create user_otps table for storing OTP codes
  2. Add RLS policies for security
  3. Create indexes for performance
*/

-- 1) OTP table
CREATE TABLE IF NOT EXISTS public.user_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,                           -- set for sign-in; null for pre-signup
  email text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('signup','signin')),
  code_hash text NOT NULL,                -- store hash, never raw code
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  ip text,
  ua text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Quick lookups
CREATE INDEX IF NOT EXISTS idx_user_otps_email ON public.user_otps (lower(email));
CREATE INDEX IF NOT EXISTS idx_user_otps_user ON public.user_otps (user_id);
CREATE INDEX IF NOT EXISTS idx_user_otps_expires ON public.user_otps (expires_at);
CREATE INDEX IF NOT EXISTS idx_user_otps_purpose ON public.user_otps (purpose);

-- 2) RLS: users can read their own rows; inserts/updates by service role
ALTER TABLE public.user_otps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read-own-otps"
ON public.user_otps FOR SELECT
TO authenticated
USING (
  (user_id IS NOT NULL AND user_id = auth.uid())
  OR (user_id IS NULL AND lower(email) = lower(auth.jwt()->>'email'))
);

-- No direct insert/update/delete from client:
CREATE POLICY "no-client-mutate-otps"
ON public.user_otps FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);