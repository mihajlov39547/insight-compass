-- 1. Status tracking for research runs
ALTER TABLE public.plant_case_research_runs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'started',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.plant_case_research_runs
  DROP CONSTRAINT IF EXISTS plant_case_research_runs_status_check;
ALTER TABLE public.plant_case_research_runs
  ADD CONSTRAINT plant_case_research_runs_status_check
  CHECK (status IN ('started', 'completed', 'failed'));

-- 2. Quota applies only to non-failed runs: a failed run can be retried today.
ALTER TABLE public.plant_case_research_runs
  DROP CONSTRAINT IF EXISTS plant_case_research_runs_user_day_unique;

CREATE UNIQUE INDEX IF NOT EXISTS plant_case_research_runs_user_day_active_uidx
  ON public.plant_case_research_runs (user_id, run_date)
  WHERE status <> 'failed';

CREATE INDEX IF NOT EXISTS plant_case_research_runs_user_date_idx
  ON public.plant_case_research_runs (user_id, run_date, status);

DROP TRIGGER IF EXISTS set_plant_case_research_runs_updated_at ON public.plant_case_research_runs;
CREATE TRIGGER set_plant_case_research_runs_updated_at
  BEFORE UPDATE ON public.plant_case_research_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Quota is enforced server-side only: clients may read, never write.
DROP POLICY IF EXISTS "Users can create their own research runs" ON public.plant_case_research_runs;
REVOKE INSERT, UPDATE, DELETE ON public.plant_case_research_runs FROM authenticated;
GRANT SELECT ON public.plant_case_research_runs TO authenticated;
GRANT ALL ON public.plant_case_research_runs TO service_role;

-- 4. Clients may only update their own pinned research messages.
DROP POLICY IF EXISTS "Users can update their own plant case chat messages" ON public.plant_case_chat_messages;
CREATE POLICY "Users can update their own research chat messages"
  ON public.plant_case_chat_messages
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND role = 'assistant'
    AND metadata ->> 'kind' = 'research'
    AND EXISTS (
      SELECT 1 FROM public.plant_cases pc
      WHERE pc.id = plant_case_chat_messages.case_id AND pc.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'assistant'
    AND metadata ->> 'kind' = 'research'
    AND EXISTS (
      SELECT 1 FROM public.plant_cases pc
      WHERE pc.id = plant_case_chat_messages.case_id AND pc.user_id = auth.uid()
    )
  );