/*
  # User Profiles and Subscriptions System
  
  1. Create app_users table (user profiles)
  2. Create subscriptions table (subscription management)
  3. Add triggers for auto-profile creation
  4. Add RLS policies for security
  5. Add server-only functions for subscription management
*/

-- SCHEMA: APP USERS (profile) -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,                         -- denormalized for convenience
  full_name text DEFAULT '',
  company text DEFAULT '',
  country text DEFAULT '',
  phone text DEFAULT '',
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  onboarding jsonb NOT NULL DEFAULT '{}'::jsonb,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_users_email ON public.app_users (lower(email));

-- Keep email & updated_at fresh
CREATE OR REPLACE FUNCTION public.touch_app_users_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.updated_at := now();
  RETURN new;
END$$;

DROP TRIGGER IF EXISTS trg_touch_app_users ON public.app_users;
CREATE TRIGGER trg_touch_app_users
BEFORE UPDATE ON public.app_users
FOR EACH ROW EXECUTE FUNCTION public.touch_app_users_updated_at();

-- AUTO-PROFILE ON SIGNUP (trigger on auth.users)
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.app_users (id, email, full_name, company, country, phone)
  VALUES (
    new.id, 
    new.email, 
    COALESCE(new.raw_user_meta_data->>'firstName','') || ' ' || COALESCE(new.raw_user_meta_data->>'lastName',''),
    COALESCE(new.raw_user_meta_data->>'company',''),
    COALESCE(new.raw_user_meta_data->>'country',''),
    COALESCE(new.raw_user_meta_data->>'phone','')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END$$;

-- Create trigger only if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_handle_new_auth_user'
  ) THEN
    CREATE TRIGGER trg_handle_new_auth_user
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
  END IF;
END$$;

-- RLS for app_users
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

-- Read own, update own; admin can read/update all
CREATE POLICY "app_users_select_own_or_admin"
ON public.app_users FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role'),'user') = 'admin'
);

CREATE POLICY "app_users_update_own_or_admin"
ON public.app_users FOR UPDATE
TO authenticated
USING (
  id = auth.uid()
  OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role'),'user') = 'admin'
)
WITH CHECK (
  id = auth.uid()
  OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role'),'user') = 'admin'
);

-- Prevent insert/delete from client (server does insert via trigger)
CREATE POLICY "app_users_no_client_insert"
ON public.app_users FOR INSERT TO authenticated
WITH CHECK (false);

CREATE POLICY "app_users_no_client_delete"
ON public.app_users FOR DELETE TO authenticated
USING (false);


-- SCHEMA: SUBSCRIPTIONS ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'manual' CHECK (provider IN ('stripe','paddle','manual')),
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','starter','pro','enterprise')),
  status text NOT NULL DEFAULT 'incomplete' CHECK (status IN ('incomplete','trialing','active','past_due','canceled','paused')),
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  period_start timestamptz,
  period_end timestamptz,
  trial_end timestamptz,
  seats int NOT NULL DEFAULT 1,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);

-- Only one 'active' or 'trialing' per user
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_single_active
ON public.subscriptions(user_id)
WHERE status IN ('active','trialing');

-- update timestamp
CREATE OR REPLACE FUNCTION public.touch_subscriptions_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.updated_at := now();
  RETURN new;
END$$;

DROP TRIGGER IF EXISTS trg_touch_subscriptions ON public.subscriptions;
CREATE TRIGGER trg_touch_subscriptions
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.touch_subscriptions_updated_at();

-- RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_select_own_or_admin"
ON public.subscriptions FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role'),'user') = 'admin'
);

CREATE POLICY "subscriptions_update_own_or_admin"
ON public.subscriptions FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role'),'user') = 'admin'
)
WITH CHECK (
  user_id = auth.uid()
  OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role'),'user') = 'admin'
);

-- For client: disallow insert/delete; backoffice or server functions handle it
CREATE POLICY "subscriptions_no_client_insert"
ON public.subscriptions FOR INSERT TO authenticated
WITH CHECK (false);

CREATE POLICY "subscriptions_no_client_delete"
ON public.subscriptions FOR DELETE TO authenticated
USING (false);


-- SERVER-ONLY HELPERS (set via service role) --------------------------------
-- Promote/demote plan via service role (Netlify function)
CREATE OR REPLACE FUNCTION public.set_user_subscription(
  p_user_id uuid,
  p_provider text,
  p_plan text,
  p_status text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_trial_end timestamptz,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  -- upsert: cancel prior active/trialing if needed
  UPDATE public.subscriptions
    SET status = 'canceled', updated_at = now()
  WHERE user_id = p_user_id
    AND status IN ('active','trialing')
    AND (p_status IN ('active','trialing'));

  INSERT INTO public.subscriptions(
    user_id, provider, plan, status, period_start, period_end, trial_end, meta
  ) VALUES (
    p_user_id, p_provider, p_plan, p_status, p_period_start, p_period_end, p_trial_end, COALESCE(p_meta,'{}'::jsonb)
  );
END$$;

-- lock it to service role only
REVOKE ALL ON FUNCTION public.set_user_subscription(uuid,text,text,text,timestamptz,timestamptz,timestamptz,jsonb) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.set_user_subscription(uuid,text,text,text,timestamptz,timestamptz,timestamptz,jsonb) TO service_role;

-- Create default free subscription for new users
CREATE OR REPLACE FUNCTION public.create_default_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, provider, plan, status, seats)
  VALUES (NEW.id, 'manual', 'free', 'active', 1)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END$$;

-- Create trigger for default subscription
DROP TRIGGER IF EXISTS trg_create_default_subscription ON public.app_users;
CREATE TRIGGER trg_create_default_subscription
AFTER INSERT ON public.app_users
FOR EACH ROW EXECUTE FUNCTION public.create_default_subscription();