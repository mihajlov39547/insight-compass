ALTER TABLE public.plant_diagnoses
  ADD COLUMN IF NOT EXISTS plant_relevance text NULL,
  ADD COLUMN IF NOT EXISTS plant_relevance_reason text NULL;