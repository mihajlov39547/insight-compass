-- Align DB default with frontend default selection strategy.
-- Chat runtime still resolves "auto" to TASK_MODEL_CONFIG.chat_default.

ALTER TABLE public.user_settings
  ALTER COLUMN preferred_model SET DEFAULT 'auto';

UPDATE public.user_settings
SET preferred_model = 'auto'
WHERE preferred_model IS NULL
   OR preferred_model IN (
     'google/gemini-3.1-pro-preview',
     'openai/gpt-5-nano'
   );
