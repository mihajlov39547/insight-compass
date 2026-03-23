ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS response_length text NOT NULL DEFAULT 'Standard',
  ADD COLUMN IF NOT EXISTS retrieval_depth text NOT NULL DEFAULT 'Medium',
  ADD COLUMN IF NOT EXISTS cite_sources boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_summarize boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS preferred_model text NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  ADD COLUMN IF NOT EXISTS show_suggested_prompts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_answer_formatting boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS layout_preference text NOT NULL DEFAULT 'comfortable',
  ADD COLUMN IF NOT EXISTS language_preference text NOT NULL DEFAULT 'en';