
CREATE TABLE public.plant_diagnoses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.plant_cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'plantnet_disease',
  rank int NOT NULL,
  score numeric,
  problem_type text NOT NULL DEFAULT 'disease',
  name text,
  description text,
  affected_organs text[],
  raw_result jsonb,
  raw_response jsonb,
  language text,
  plant_context_source text,
  plant_scientific_name text,
  plant_common_name text,
  is_confirmed boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX plant_diagnoses_case_idx ON public.plant_diagnoses (case_id, rank);
CREATE UNIQUE INDEX plant_diagnoses_one_confirmed_per_case
  ON public.plant_diagnoses (case_id)
  WHERE is_confirmed = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plant_diagnoses TO authenticated;
GRANT ALL ON public.plant_diagnoses TO service_role;

ALTER TABLE public.plant_diagnoses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own diagnoses"
  ON public.plant_diagnoses FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own diagnoses"
  ON public.plant_diagnoses FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own diagnoses"
  ON public.plant_diagnoses FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own diagnoses"
  ON public.plant_diagnoses FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

ALTER TABLE public.plant_cases
  ADD COLUMN IF NOT EXISTS confirmed_diagnosis_id uuid REFERENCES public.plant_diagnoses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_problem_type text,
  ADD COLUMN IF NOT EXISTS confirmed_problem_name text,
  ADD COLUMN IF NOT EXISTS diagnosed_at timestamptz,
  ADD COLUMN IF NOT EXISTS diagnosis_provider text;
