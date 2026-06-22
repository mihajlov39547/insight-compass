CREATE TABLE public.chat_message_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id uuid NOT NULL,
  chat_id uuid NULL,
  project_id uuid NULL,
  notebook_id uuid NULL,
  message_role text NOT NULL,
  message_snippet text NOT NULL,
  message_content_snapshot text NULL,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT chat_message_pins_unique_user_message UNIQUE (user_id, message_id),
  CONSTRAINT chat_message_pins_snapshot_size CHECK (message_content_snapshot IS NULL OR length(message_content_snapshot) <= 8000),
  CONSTRAINT chat_message_pins_role_chk CHECK (message_role IN ('user','assistant','system','tool'))
);

CREATE INDEX idx_chat_message_pins_user ON public.chat_message_pins (user_id, pinned_at DESC);
CREATE INDEX idx_chat_message_pins_chat ON public.chat_message_pins (chat_id, pinned_at DESC) WHERE chat_id IS NOT NULL;
CREATE INDEX idx_chat_message_pins_project ON public.chat_message_pins (project_id, pinned_at DESC) WHERE project_id IS NOT NULL;
CREATE INDEX idx_chat_message_pins_notebook ON public.chat_message_pins (notebook_id, pinned_at DESC) WHERE notebook_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_message_pins TO authenticated;
GRANT ALL ON public.chat_message_pins TO service_role;

ALTER TABLE public.chat_message_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own pins"
  ON public.chat_message_pins FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own pins"
  ON public.chat_message_pins FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (project_id IS NULL OR public.check_item_permission(auth.uid(), project_id, 'project', 'viewer'))
    AND (notebook_id IS NULL OR public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'viewer'))
  );

CREATE POLICY "Users can update their own pins"
  ON public.chat_message_pins FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own pins"
  ON public.chat_message_pins FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);