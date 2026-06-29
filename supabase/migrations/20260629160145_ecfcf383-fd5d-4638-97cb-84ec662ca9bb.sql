
CREATE TABLE public.plant_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  notebook_id uuid REFERENCES public.notebooks(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ready_for_identification','identified','diagnosed','treated','archived')),
  user_goal text
    CHECK (user_goal IS NULL OR user_goal IN ('identify','diagnose','improve_growth','increase_income')),
  location_text text,
  crop_context text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plant_cases TO authenticated;
GRANT ALL ON public.plant_cases TO service_role;

ALTER TABLE public.plant_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own plant cases" ON public.plant_cases
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER plant_cases_set_updated_at
  BEFORE UPDATE ON public.plant_cases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX plant_cases_user_id_created_at_idx ON public.plant_cases(user_id, created_at DESC);

CREATE TABLE public.plant_case_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.plant_cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  storage_path text NOT NULL,
  image_role text NOT NULL DEFAULT 'auto'
    CHECK (image_role IN ('auto','whole_plant','leaf','flower','fruit','bark','stem','root','other')),
  original_filename text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plant_case_images TO authenticated;
GRANT ALL ON public.plant_case_images TO service_role;

ALTER TABLE public.plant_case_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own plant case images" ON public.plant_case_images
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX plant_case_images_case_id_idx ON public.plant_case_images(case_id);

-- Storage policies for plant-case-images bucket (path prefix = userId)
CREATE POLICY "Plant images: owner read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'plant-case-images' AND (storage.foldername(name))[2] = auth.uid()::text);

CREATE POLICY "Plant images: owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'plant-case-images' AND (storage.foldername(name))[2] = auth.uid()::text);

CREATE POLICY "Plant images: owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'plant-case-images' AND (storage.foldername(name))[2] = auth.uid()::text);

CREATE POLICY "Plant images: owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'plant-case-images' AND (storage.foldername(name))[2] = auth.uid()::text);
