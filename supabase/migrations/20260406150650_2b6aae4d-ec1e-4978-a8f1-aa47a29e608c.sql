
-- Allow any authenticated user to read profiles (needed for shared items to show sharer info)
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Authenticated users can view profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

-- Unique constraint to prevent duplicate shares by email
CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_unique_email_item
ON public.shares (shared_with_email, item_id, item_type)
WHERE shared_with_email IS NOT NULL;
