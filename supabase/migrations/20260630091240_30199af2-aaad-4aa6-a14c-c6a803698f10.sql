
DROP POLICY IF EXISTS "Users manage own plant case images" ON public.plant_case_images;

CREATE POLICY "Plant case images: select own"
ON public.plant_case_images FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.plant_cases pc WHERE pc.id = case_id AND pc.user_id = auth.uid())
);

CREATE POLICY "Plant case images: insert own"
ON public.plant_case_images FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.plant_cases pc WHERE pc.id = case_id AND pc.user_id = auth.uid())
);

CREATE POLICY "Plant case images: update own"
ON public.plant_case_images FOR UPDATE TO authenticated
USING (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.plant_cases pc WHERE pc.id = case_id AND pc.user_id = auth.uid())
)
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.plant_cases pc WHERE pc.id = case_id AND pc.user_id = auth.uid())
);

CREATE POLICY "Plant case images: delete own"
ON public.plant_case_images FOR DELETE TO authenticated
USING (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.plant_cases pc WHERE pc.id = case_id AND pc.user_id = auth.uid())
);
