CREATE TABLE public.plant_species_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.plant_cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identification_id uuid REFERENCES public.plant_identifications(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'trefle',
  provider_id text,
  slug text,
  scientific_name text,
  common_name text,
  family text,
  genus text,
  status text,
  rank text,
  profile jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX plant_species_profiles_case_idx ON public.plant_species_profiles(case_id);
CREATE INDEX plant_species_profiles_identification_idx ON public.plant_species_profiles(identification_id);
CREATE INDEX plant_species_profiles_user_idx ON public.plant_species_profiles(user_id);

GRANT SELECT ON public.plant_species_profiles TO authenticated;
GRANT ALL ON public.plant_species_profiles TO service_role;

ALTER TABLE public.plant_species_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own plant profiles"
  ON public.plant_species_profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_plant_species_profiles_updated_at
  BEFORE UPDATE ON public.plant_species_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
