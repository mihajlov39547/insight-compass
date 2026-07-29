
CREATE TABLE public.plant_case_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.plant_cases(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX plant_case_chat_messages_case_created_idx
  ON public.plant_case_chat_messages (case_id, created_at);
CREATE INDEX plant_case_chat_messages_user_created_idx
  ON public.plant_case_chat_messages (user_id, created_at);

GRANT SELECT, INSERT ON public.plant_case_chat_messages TO authenticated;
GRANT ALL ON public.plant_case_chat_messages TO service_role;

ALTER TABLE public.plant_case_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own plant case chat messages"
  ON public.plant_case_chat_messages
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.plant_cases pc
      WHERE pc.id = plant_case_chat_messages.case_id
        AND pc.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own plant case chat messages"
  ON public.plant_case_chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.plant_cases pc
      WHERE pc.id = plant_case_chat_messages.case_id
        AND pc.user_id = auth.uid()
    )
  );
