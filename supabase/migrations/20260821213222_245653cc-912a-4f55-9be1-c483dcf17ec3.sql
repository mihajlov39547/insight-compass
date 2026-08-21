CREATE TABLE public.plant_case_visual_opinions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES public.plant_cases(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'serpapi_google_ai_mode',
  mode text NOT NULL CHECK (mode IN ('identify','diagnose')),
  image_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  query text NOT NULL,
  language text,
  country text,
  status text NOT NULL DEFAULT 'success',
  opinion_summary text,
  structured_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plant_case_visual_opinions_case_provider_mode_key UNIQUE (case_id, provider, mode)
);

CREATE INDEX plant_case_visual_opinions_case_idx ON public.plant_case_visual_opinions (case_id);
CREATE INDEX plant_case_visual_opinions_user_created_idx ON public.plant_case_visual_opinions (user_id, created_at DESC);

GRANT SELECT ON public.plant_case_visual_opinions TO authenticated;
GRANT ALL ON public.plant_case_visual_opinions TO service_role;

ALTER TABLE public.plant_case_visual_opinions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view visual opinions of their own plant cases"
ON public.plant_case_visual_opinions
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.plant_cases pc
    WHERE pc.id = plant_case_visual_opinions.case_id
      AND pc.user_id = auth.uid()
  )
);

CREATE TRIGGER plant_case_visual_opinions_set_updated_at
BEFORE UPDATE ON public.plant_case_visual_opinions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.visual_second_opinion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  case_id uuid REFERENCES public.plant_cases(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'serpapi_google_ai_mode',
  mode text NOT NULL,
  status text NOT NULL DEFAULT 'started',
  run_month date NOT NULL DEFAULT date_trunc('month', now())::date,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX visual_second_opinion_runs_user_month_idx ON public.visual_second_opinion_runs (user_id, run_month);

GRANT SELECT ON public.visual_second_opinion_runs TO authenticated;
GRANT ALL ON public.visual_second_opinion_runs TO service_role;

ALTER TABLE public.visual_second_opinion_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own visual second opinion runs"
ON public.visual_second_opinion_runs
FOR SELECT
TO authenticated
USING (user_id = auth.uid());