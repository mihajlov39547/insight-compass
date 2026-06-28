ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS preferred_model_family text DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS preferred_thinking_level text DEFAULT 'medium';