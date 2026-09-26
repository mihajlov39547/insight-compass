CREATE TABLE public.plant_case_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.plant_cases(id) ON DELETE CASCADE,
  followup_date date NOT NULL DEFAULT current_date,
  title text,
  note text,
  outcome_status text NOT NULL DEFAULT 'unknown' CHECK (outcome_status IN ('improved','unchanged','worse','resolved','unknown')),
  related_area text NOT NULL DEFAULT 'general' CHECK (related_area IN ('identification','diagnosis','growth','income','general')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plant_case_followups TO authenticated;
GRANT ALL ON public.plant_case_followups TO service_role;
ALTER TABLE public.plant_case_followups ENABLE ROW LEVEL SECURITY;
CREATE INDEX plant_case_followups_case_idx ON public.plant_case_followups(case_id, followup_date DESC, created_at DESC);

CREATE POLICY "Owners read followups" ON public.plant_case_followups FOR SELECT TO authenticated
USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.plant_cases c WHERE c.id = case_id AND c.user_id = auth.uid()));
CREATE POLICY "Owners insert followups" ON public.plant_case_followups FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.plant_cases c WHERE c.id = case_id AND c.user_id = auth.uid()));
CREATE POLICY "Owners update followups" ON public.plant_case_followups FOR UPDATE TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.plant_cases c WHERE c.id = case_id AND c.user_id = auth.uid()));
CREATE POLICY "Owners delete followups" ON public.plant_case_followups FOR DELETE TO authenticated
USING (user_id = auth.uid());

CREATE TRIGGER plant_case_followups_updated_at BEFORE UPDATE ON public.plant_case_followups
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.plant_case_images
  ADD COLUMN followup_id uuid REFERENCES public.plant_case_followups(id) ON DELETE SET NULL,
  ADD COLUMN image_context text CHECK (image_context IS NULL OR image_context IN ('initial','followup'));
CREATE INDEX plant_case_images_followup_idx ON public.plant_case_images(followup_id);