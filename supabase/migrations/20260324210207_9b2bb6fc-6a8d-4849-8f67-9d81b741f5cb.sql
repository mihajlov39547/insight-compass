
-- Shares table for tracking shared projects and notebooks
CREATE TABLE public.shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type text NOT NULL CHECK (item_type IN ('project', 'notebook')),
  item_id uuid NOT NULL,
  shared_by_user_id uuid NOT NULL,
  shared_with_user_id uuid NOT NULL,
  permission text NOT NULL DEFAULT 'viewer' CHECK (permission IN ('viewer', 'editor', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(item_type, item_id, shared_with_user_id)
);

ALTER TABLE public.shares ENABLE ROW LEVEL SECURITY;

-- Users can see shares where they are the recipient or the sharer
CREATE POLICY "Users can view shares they are part of"
  ON public.shares FOR SELECT TO authenticated
  USING (auth.uid() = shared_with_user_id OR auth.uid() = shared_by_user_id);

-- Users can create shares for items they own
CREATE POLICY "Users can create shares"
  ON public.shares FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = shared_by_user_id);

-- Users can delete shares they created
CREATE POLICY "Users can delete shares they created"
  ON public.shares FOR DELETE TO authenticated
  USING (auth.uid() = shared_by_user_id);

-- Users can update shares they created
CREATE POLICY "Users can update shares they created"
  ON public.shares FOR UPDATE TO authenticated
  USING (auth.uid() = shared_by_user_id);
