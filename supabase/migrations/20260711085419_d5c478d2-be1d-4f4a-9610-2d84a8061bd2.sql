CREATE TABLE public.plant_diagnosis_interpretations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.plant_cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'gemini',
  model text,
  fallback_model text,
  used_fallback boolean NOT NULL DEFAULT false,
  fallback_reason text,
  diagnosis_run_at timestamptz NOT NULL DEFAULT now(),
  language text,
  summary text,
  overall_confidence text,
  interpretation jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX plant_diagnosis_interpretations_case_created_idx
  ON public.plant_diagnosis_interpretations (case_id, created_at DESC);

GRANT SELECT ON public.plant_diagnosis_interpretations TO authenticated;
GRANT ALL ON public.plant_diagnosis_interpretations TO service_role;

ALTER TABLE public.plant_diagnosis_interpretations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own interpretations"
  ON public.plant_diagnosis_interpretations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
