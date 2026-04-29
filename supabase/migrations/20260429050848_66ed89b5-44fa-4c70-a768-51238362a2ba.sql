-- Drop the SECURITY DEFINER view
DROP VIEW IF EXISTS public.public_profiles;

-- Recreate as security_invoker view (safe)
CREATE VIEW public.public_profiles
WITH (security_invoker = true) AS
SELECT
  user_id,
  full_name,
  username,
  avatar_url,
  email
FROM public.profiles;

GRANT SELECT ON public.public_profiles TO authenticated;

-- Drop the owner-only policy and replace with a permissive SELECT
-- Then use column-level grants to restrict sensitive fields
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;

CREATE POLICY "Authenticated users can view profile rows"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

-- Revoke all column access from authenticated, then grant only safe columns
REVOKE SELECT ON public.profiles FROM authenticated;

GRANT SELECT (user_id, full_name, username, avatar_url, email)
  ON public.profiles TO authenticated;

-- Owner needs full access to all columns (including phone, bio, location, website, banner_url, plan)
-- We grant column-level SELECT for sensitive fields too, but add a row-level policy
-- restricting their visibility via a separate mechanism.
-- Postgres doesn't natively combine column grants + row policy per column,
-- so for sensitive columns we rely on the application reading them only for self.
-- To enforce at DB level, grant sensitive columns and add a strict policy:

GRANT SELECT (phone, bio, location, website, banner_url, plan, id, created_at, updated_at)
  ON public.profiles TO authenticated;

-- Replace the broad policy with one that restricts based on whether sensitive columns are accessed.
-- Since PG can't do per-column RLS, we instead enforce: only owner can SELECT rows
-- that include sensitive columns. We accomplish privacy by using TWO policies + the view.
-- Simplest correct approach: keep broad row SELECT but split into two policies via separate roles.
-- Practical solution: keep current policy (row visible to all authenticated) BUT
-- application MUST use public_profiles view for other users. Sensitive columns are still
-- query-able by any authenticated user since column grants allow it.

-- Better: restrict row SELECT to owner-only, keep the view security_invoker,
-- and grant the view direct table access via SECURITY DEFINER function.

DROP POLICY IF EXISTS "Authenticated users can view profile rows" ON public.profiles;
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT ON public.profiles TO authenticated;

CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Replace view with a SECURITY DEFINER function that returns only safe fields
DROP VIEW IF EXISTS public.public_profiles;

CREATE OR REPLACE FUNCTION public.get_public_profiles(_user_ids uuid[])
RETURNS TABLE (
  user_id uuid,
  full_name text,
  username text,
  avatar_url text,
  email text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id, full_name, username, avatar_url, email
  FROM public.profiles
  WHERE user_id = ANY(_user_ids);
$$;

CREATE OR REPLACE FUNCTION public.get_public_profile(_user_id uuid)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  username text,
  avatar_url text,
  email text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id, full_name, username, avatar_url, email
  FROM public.profiles
  WHERE user_id = _user_id;
$$;

CREATE OR REPLACE FUNCTION public.find_user_id_by_email(_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id FROM public.profiles WHERE lower(email) = lower(_email) LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.find_user_id_by_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_user_id_by_email(text) TO authenticated;