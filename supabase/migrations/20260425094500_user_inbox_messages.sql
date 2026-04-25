-- User inbox messages.
-- Admins/services send messages with SQL inserts. Users can read their own
-- messages and only toggle read/unread state via read_at.

CREATE TABLE IF NOT EXISTS public.user_inbox_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'message'
    CHECK (kind IN ('message', 'share_invitation', 'system', 'admin')),
  title TEXT NOT NULL,
  body TEXT,
  action_label TEXT,
  action_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_type TEXT,
  source_id UUID,
  read_at TIMESTAMPTZ,
  is_read BOOLEAN GENERATED ALWAYS AS (read_at IS NOT NULL) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_inbox_messages_user_sort
  ON public.user_inbox_messages (user_id, is_read ASC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_inbox_messages_unread
  ON public.user_inbox_messages (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_inbox_messages_source_unique
  ON public.user_inbox_messages (source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_user_inbox_messages_updated_at ON public.user_inbox_messages;
CREATE TRIGGER set_user_inbox_messages_updated_at
  BEFORE UPDATE ON public.user_inbox_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_inbox_messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.user_inbox_messages TO authenticated;
GRANT UPDATE (read_at) ON public.user_inbox_messages TO authenticated;

DO $$ BEGIN
  CREATE POLICY "Users can read their inbox messages"
    ON public.user_inbox_messages FOR SELECT TO authenticated
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update their inbox read state"
    ON public.user_inbox_messages FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.create_share_inbox_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  item_name TEXT;
  inviter_name TEXT;
BEGIN
  IF NEW.shared_with_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.item_type = 'project' THEN
    SELECT name INTO item_name
    FROM public.projects
    WHERE id = NEW.item_id;
  ELSIF NEW.item_type = 'notebook' THEN
    SELECT name INTO item_name
    FROM public.notebooks
    WHERE id = NEW.item_id;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), NULLIF(username, ''), email, 'Someone')
  INTO inviter_name
  FROM public.profiles
  WHERE user_id = NEW.shared_by_user_id;

  INSERT INTO public.user_inbox_messages (
    user_id,
    kind,
    title,
    body,
    action_label,
    action_url,
    metadata,
    source_type,
    source_id
  )
  VALUES (
    NEW.shared_with_user_id,
    'share_invitation',
    COALESCE(inviter_name, 'Someone') || ' shared ' || COALESCE(item_name, 'an item') || ' with you',
    'You now have ' || NEW.permission || ' access to this ' || NEW.item_type || '.',
    'Open',
    '/?shared=' || NEW.item_id::text,
    jsonb_build_object(
      'itemType', NEW.item_type,
      'itemId', NEW.item_id,
      'permission', NEW.permission,
      'sharedByUserId', NEW.shared_by_user_id
    ),
    'share',
    NEW.id
  )
  ON CONFLICT (source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL
  DO UPDATE
  SET title = EXCLUDED.title,
      body = EXCLUDED.body,
      action_label = EXCLUDED.action_label,
      action_url = EXCLUDED.action_url,
      metadata = EXCLUDED.metadata;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_share_inbox_message_on_insert ON public.shares;
CREATE TRIGGER create_share_inbox_message_on_insert
  AFTER INSERT ON public.shares
  FOR EACH ROW
  WHEN (NEW.shared_with_user_id IS NOT NULL)
  EXECUTE FUNCTION public.create_share_inbox_message();

DROP TRIGGER IF EXISTS create_share_inbox_message_on_recipient_link ON public.shares;
CREATE TRIGGER create_share_inbox_message_on_recipient_link
  AFTER UPDATE OF shared_with_user_id ON public.shares
  FOR EACH ROW
  WHEN (OLD.shared_with_user_id IS NULL AND NEW.shared_with_user_id IS NOT NULL)
  EXECUTE FUNCTION public.create_share_inbox_message();

CREATE OR REPLACE FUNCTION public.create_welcome_inbox_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.user_inbox_messages (
    user_id,
    kind,
    title,
    body,
    action_label,
    action_url,
    metadata,
    source_type,
    source_id
  )
  VALUES (
    NEW.id,
    'system',
    'Welcome to Researcher',
    'Your knowledge workspace is ready. Create a project, upload documents, and start asking questions grounded in your own sources.',
    'Start exploring',
    '/',
    jsonb_build_object('event', 'user_registered'),
    'welcome_user',
    NEW.id
  )
  ON CONFLICT (source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL
  DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_welcome_inbox_message_on_user_insert ON auth.users;
CREATE TRIGGER create_welcome_inbox_message_on_user_insert
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.create_welcome_inbox_message();
