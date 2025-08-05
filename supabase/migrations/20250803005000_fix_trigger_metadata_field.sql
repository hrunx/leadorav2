/*
  # Fix User Data Population Trigger - Correct Metadata Field
  
  The auth.users table in Supabase uses `raw_user_meta_data` not `user_metadata`
*/

-- Fix the trigger to use the correct field name
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