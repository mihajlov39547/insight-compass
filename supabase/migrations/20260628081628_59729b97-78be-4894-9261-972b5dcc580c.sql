-- Sanitize any invalid existing values first so the CHECK constraints can be added.
UPDATE public.user_settings
SET preferred_model_family = 'auto'
WHERE preferred_model_family IS NULL
   OR preferred_model_family NOT IN ('auto', 'gemini', 'gpt', 'gemma');

UPDATE public.user_settings
SET preferred_thinking_level = 'medium'
WHERE preferred_thinking_level IS NULL
   OR preferred_thinking_level NOT IN ('low', 'medium', 'high');

ALTER TABLE public.user_settings
  ADD CONSTRAINT user_settings_preferred_model_family_chk
    CHECK (preferred_model_family IN ('auto', 'gemini', 'gpt', 'gemma'));

ALTER TABLE public.user_settings
  ADD CONSTRAINT user_settings_preferred_thinking_level_chk
    CHECK (preferred_thinking_level IN ('low', 'medium', 'high'));