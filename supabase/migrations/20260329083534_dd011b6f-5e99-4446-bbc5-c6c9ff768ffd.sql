
-- Create web_search_responses table
CREATE TABLE public.web_search_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NULL,
  project_id uuid NULL,
  chat_id uuid NULL,
  message_id uuid NULL,
  provider text NOT NULL,
  query text NOT NULL,
  provider_request_id text NULL,
  provider_response_time numeric NULL,
  provider_answer text NULL,
  follow_up_questions jsonb NULL,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_response jsonb NOT NULL,
  normalized_response jsonb NOT NULL,
  status text NOT NULL DEFAULT 'success',
  error_message text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX idx_web_search_responses_message_id ON public.web_search_responses (message_id);
CREATE INDEX idx_web_search_responses_chat_id ON public.web_search_responses (chat_id);
CREATE INDEX idx_web_search_responses_project_id ON public.web_search_responses (project_id);
CREATE INDEX idx_web_search_responses_provider ON public.web_search_responses (provider);
CREATE INDEX idx_web_search_responses_created_at ON public.web_search_responses (created_at DESC);

-- RLS
ALTER TABLE public.web_search_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own web search responses"
  ON public.web_search_responses FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own web search responses"
  ON public.web_search_responses FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own web search responses"
  ON public.web_search_responses FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- updated_at trigger
CREATE TRIGGER update_web_search_responses_updated_at
  BEFORE UPDATE ON public.web_search_responses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
