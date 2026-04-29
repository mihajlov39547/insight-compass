-- Restrict profiles SELECT to owner only; expose safe collaboration fields via a view

DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.profiles;

CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Public-safe view: only fields needed for sharing/collaboration UI
-- Excludes: phone, bio, location, website, banner_url, plan
CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = true) AS
SELECT
  user_id,
  full_name,
  username,
  avatar_url,
  email
FROM public.profiles;

GRANT SELECT ON public.public_profiles TO authenticated;

-- Allow authenticated users to read the safe subset through the view
CREATE POLICY "Authenticated users can view safe profile fields"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

-- Wait — we cannot have both. Drop the broad one; instead use a SECURITY DEFINER approach via the view.
DROP POLICY IF EXISTS "Authenticated users can view safe profile fields" ON public.profiles;

-- Recreate the view as SECURITY DEFINER (bypasses RLS) so collaboration UI keeps working
DROP VIEW IF EXISTS public.public_profiles;
CREATE VIEW public.public_profiles
WITH (security_invoker = false) AS
SELECT
  user_id,
  full_name,
  username,
  avatar_url,
  email
FROM public.profiles;

GRANT SELECT ON public.public_profiles TO authenticated;