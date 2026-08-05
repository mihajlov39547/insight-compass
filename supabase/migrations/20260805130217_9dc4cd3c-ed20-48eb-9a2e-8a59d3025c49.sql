ALTER TABLE public.plant_case_chat_messages
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS set_plant_case_chat_messages_updated_at ON public.plant_case_chat_messages;
CREATE TRIGGER set_plant_case_chat_messages_updated_at
BEFORE UPDATE ON public.plant_case_chat_messages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.plant_case_research_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES public.plant_cases(id) ON DELETE CASCADE,
  run_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT plant_case_research_runs_user_day_unique UNIQUE (user_id, run_date)
);

GRANT SELECT, INSERT ON public.plant_case_research_runs TO authenticated;
GRANT ALL ON public.plant_case_research_runs TO service_role;

ALTER TABLE public.plant_case_research_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own research runs"
ON public.plant_case_research_runs
FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can create their own research runs"
ON public.plant_case_research_runs
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.plant_cases pc
    WHERE pc.id = case_id AND pc.user_id = auth.uid()
  )
);

CREATE POLICY "Service role manages research runs"
ON public.plant_case_research_runs
FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS plant_case_research_runs_user_date_idx
  ON public.plant_case_research_runs (user_id, run_date DESC);
