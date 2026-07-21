CREATE TABLE public.plant_case_grounding_contexts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.plant_cases(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  primary_scientific_name TEXT,
  primary_common_name TEXT,
  location_text TEXT,
  provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_code TEXT,
  error_message TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_plant_case_grounding_contexts_case_id
  ON public.plant_case_grounding_contexts(case_id, fetched_at DESC);
CREATE INDEX idx_plant_case_grounding_contexts_user_id
  ON public.plant_case_grounding_contexts(user_id);

GRANT SELECT ON public.plant_case_grounding_contexts TO authenticated;
GRANT ALL ON public.plant_case_grounding_contexts TO service_role;

ALTER TABLE public.plant_case_grounding_contexts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own grounding contexts"
  ON public.plant_case_grounding_contexts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_plant_case_grounding_contexts_updated_at
  BEFORE UPDATE ON public.plant_case_grounding_contexts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();