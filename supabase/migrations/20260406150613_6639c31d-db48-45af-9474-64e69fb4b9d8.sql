
-- Add shared_with_email to shares for unregistered user invitations
ALTER TABLE public.shares
ADD COLUMN IF NOT EXISTS shared_with_email text;

-- Allow shared_with_user_id to be nullable (for unregistered users)
ALTER TABLE public.shares
ALTER COLUMN shared_with_user_id DROP NOT NULL;

-- Index for fast email lookups during registration
CREATE INDEX IF NOT EXISTS idx_shares_shared_with_email ON public.shares (shared_with_email) WHERE shared_with_email IS NOT NULL;

-- Update handle_new_user to link pending shares by email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  email_local text;
  base_username text;
  suffix_num integer;
  candidate text;
  username_exists boolean;
BEGIN
  email_local := lower(split_part(COALESCE(NEW.email, ''), '@', 1));
  email_local := regexp_replace(email_local, '[^a-z]', '', 'g');
  base_username := left(email_local, 5);

  IF length(base_username) < 5 THEN
    base_username := rpad(base_username, 5, 'x');
  END IF;

  LOOP
    suffix_num := floor(random() * 100)::int;
    candidate := base_username || lpad(suffix_num::text, 2, '0');
    SELECT EXISTS(
      SELECT 1 FROM public.profiles WHERE username = candidate
    ) INTO username_exists;
    EXIT WHEN NOT username_exists;
  END LOOP;

  INSERT INTO public.profiles (user_id, full_name, email, avatar_url, username)
  VALUES (
    NEW.id,
    NULLIF(COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', ''), ''),
    NEW.email,
    NULLIF(COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', NEW.raw_user_meta_data ->> 'picture', ''), ''),
    candidate
  )
  ON CONFLICT (user_id) DO UPDATE
  SET full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
      email = COALESCE(public.profiles.email, EXCLUDED.email),
      avatar_url = COALESCE(NULLIF(public.profiles.avatar_url, ''), EXCLUDED.avatar_url),
      username = COALESCE(NULLIF(public.profiles.username, ''), EXCLUDED.username);

  -- Link any pending share invitations sent to this email
  UPDATE public.shares
  SET shared_with_user_id = NEW.id
  WHERE shared_with_email = lower(NEW.email)
    AND shared_with_user_id IS NULL;

  RETURN NEW;
END;
$$;

-- RLS: Allow shared users to view shared projects
CREATE POLICY "Shared users can view shared projects"
ON public.projects
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.shares s
    WHERE s.item_type = 'project'
      AND s.item_id = projects.id
      AND s.shared_with_user_id = auth.uid()
  )
);

-- RLS: Allow shared users to view shared notebooks
CREATE POLICY "Shared users can view shared notebooks"
ON public.notebooks
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.shares s
    WHERE s.item_type = 'notebook'
      AND s.item_id = notebooks.id
      AND s.shared_with_user_id = auth.uid()
  )
);

-- RLS: Allow shared users to view chats in shared projects
CREATE POLICY "Shared users can view chats in shared projects"
ON public.chats
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.shares s
    WHERE s.item_type = 'project'
      AND s.item_id = chats.project_id
      AND s.shared_with_user_id = auth.uid()
  )
);

-- RLS: Allow shared users to view messages in shared project chats
CREATE POLICY "Shared users can view messages in shared projects"
ON public.messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.chats c
    JOIN public.shares s ON s.item_type = 'project' AND s.item_id = c.project_id
    WHERE c.id = messages.chat_id
      AND s.shared_with_user_id = auth.uid()
  )
);
