
-- Create a function to look up email by username (security definer to bypass RLS for lookup)
CREATE OR REPLACE FUNCTION public.get_email_by_username(lookup_username text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email FROM public.profiles WHERE username = lookup_username LIMIT 1;
$$;
