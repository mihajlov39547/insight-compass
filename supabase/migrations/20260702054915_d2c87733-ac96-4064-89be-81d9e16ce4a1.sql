CREATE TABLE IF NOT EXISTS public.plant_identifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.plant_cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'plantnet',
  project text NOT NULL DEFAULT 'all',
  rank int NOT NULL DEFAULT 1,
  score numeric,
  scientific_name text,
  scientific_name_without_author text,
  scientific_name_authorship text,
  common_name text,
  family text,
  genus text,
  gbif_id text,
  powo_id text,
  raw_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_response jsonb,
  remaining_identification_requests int,
  engine_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plant_identifications TO authenticated;
GRANT ALL ON public.plant_identifications TO service_role;

ALTER TABLE public.plant_identifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own plant identifications" ON public.plant_identifications;
CREATE POLICY "Users select own plant identifications"
  ON public.plant_identifications FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.plant_cases pc WHERE pc.id = plant_identifications.case_id AND pc.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users insert own plant identifications" ON public.plant_identifications;
CREATE POLICY "Users insert own plant identifications"
  ON public.plant_identifications FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.plant_cases pc WHERE pc.id = case_id AND pc.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users update own plant identifications" ON public.plant_identifications;
CREATE POLICY "Users update own plant identifications"
  ON public.plant_identifications FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.plant_cases pc WHERE pc.id = plant_identifications.case_id AND pc.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.plant_cases pc WHERE pc.id = plant_identifications.case_id AND pc.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users delete own plant identifications" ON public.plant_identifications;
CREATE POLICY "Users delete own plant identifications"
  ON public.plant_identifications FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.plant_cases pc WHERE pc.id = plant_identifications.case_id AND pc.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_plant_identifications_case ON public.plant_identifications (case_id, rank);
CREATE INDEX IF NOT EXISTS idx_plant_identifications_user ON public.plant_identifications (user_id);

ALTER TABLE public.plant_cases
  ADD COLUMN IF NOT EXISTS identified_scientific_name text,
  ADD COLUMN IF NOT EXISTS identified_common_name text,
  ADD COLUMN IF NOT EXISTS identification_confidence numeric,
  ADD COLUMN IF NOT EXISTS identified_at timestamptz,
  ADD COLUMN IF NOT EXISTS identification_provider text;
