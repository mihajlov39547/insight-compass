ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS plant_identification_language text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS plant_identification_project text NOT NULL DEFAULT 'k-southeastern-europe';

ALTER TABLE public.user_settings
  DROP CONSTRAINT IF EXISTS user_settings_plant_identification_language_chk;
ALTER TABLE public.user_settings
  ADD CONSTRAINT user_settings_plant_identification_language_chk
  CHECK (plant_identification_language IN ('en', 'sr'));

ALTER TABLE public.user_settings
  DROP CONSTRAINT IF EXISTS user_settings_plant_identification_project_chk;
ALTER TABLE public.user_settings
  ADD CONSTRAINT user_settings_plant_identification_project_chk
  CHECK (plant_identification_project IN ('k-southeastern-europe', 'k-world-flora', 'all'));