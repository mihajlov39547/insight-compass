ALTER TABLE public.plant_identifications
  ADD COLUMN IF NOT EXISTS is_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

ALTER TABLE public.plant_cases
  ADD COLUMN IF NOT EXISTS confirmed_identification_id uuid REFERENCES public.plant_identifications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_scientific_name text,
  ADD COLUMN IF NOT EXISTS confirmed_common_name text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS plant_identifications_one_confirmed_per_case
  ON public.plant_identifications(case_id) WHERE is_confirmed = true;
