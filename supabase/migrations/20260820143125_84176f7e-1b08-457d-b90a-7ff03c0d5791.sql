CREATE TABLE public.plant_case_external_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES public.plant_cases(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_plant_id text,
  scientific_name text,
  common_name text,
  family text,
  genus text,
  type text,
  match_confidence text,
  source_url text,
  image_thumb_url text,
  image_title_url text,
  profile_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plant_case_external_profiles_case_provider_key UNIQUE (case_id, provider)
);

CREATE INDEX plant_case_external_profiles_case_idx ON public.plant_case_external_profiles (case_id);

GRANT SELECT ON public.plant_case_external_profiles TO authenticated;
GRANT ALL ON public.plant_case_external_profiles TO service_role;

ALTER TABLE public.plant_case_external_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view external profiles of their own plant cases"
ON public.plant_case_external_profiles
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.plant_cases pc
    WHERE pc.id = plant_case_external_profiles.case_id
      AND pc.user_id = auth.uid()
  )
);

CREATE TRIGGER plant_case_external_profiles_set_updated_at
BEFORE UPDATE ON public.plant_case_external_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();