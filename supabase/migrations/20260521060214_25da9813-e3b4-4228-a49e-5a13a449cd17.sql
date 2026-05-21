
ALTER TABLE public.workflow_runs
  ADD COLUMN IF NOT EXISTS resume_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resumed_at timestamptz;

CREATE OR REPLACE FUNCTION public.resume_failed_activities(p_workflow_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_status workflow_run_status;
  v_resume_count integer;
  v_reset_count integer := 0;
  v_reset_ids uuid[];
BEGIN
  SELECT user_id, status, resume_count
    INTO v_user_id, v_status, v_resume_count
  FROM public.workflow_runs
  WHERE id = p_workflow_run_id
  FOR UPDATE;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'workflow_run not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF v_status NOT IN ('failed', 'running') THEN
    RAISE EXCEPTION 'workflow_run is %, only failed or running runs can be resumed', v_status
      USING ERRCODE = '22023';
  END IF;

  IF v_resume_count >= 5 THEN
    RAISE EXCEPTION 'resume cap reached (5); use full retry instead' USING ERRCODE = '22023';
  END IF;

  WITH reset AS (
    UPDATE public.activity_runs
       SET status = 'queued',
           is_terminal = false,
           attempt_count = 0,
           error_message = NULL,
           error_details = NULL,
           finished_at = NULL,
           claimed_by = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL,
           next_retry_at = NULL,
           queue_msg_id = NULL,
           scheduled_at = now(),
           updated_at = now()
     WHERE workflow_run_id = p_workflow_run_id
       AND status IN ('failed', 'dead_letter')
       AND is_optional = false
    RETURNING id
  )
  SELECT array_agg(id), count(*)::int INTO v_reset_ids, v_reset_count FROM reset;

  IF v_reset_count = 0 THEN
    RAISE EXCEPTION 'no failed activities to resume' USING ERRCODE = '22023';
  END IF;

  UPDATE public.workflow_runs
     SET status = 'running',
         failure_reason = NULL,
         completed_at = NULL,
         resume_count = resume_count + 1,
         resumed_at = now(),
         updated_at = now()
   WHERE id = p_workflow_run_id;

  INSERT INTO public.workflow_events (workflow_run_id, event_type, actor, details)
  VALUES (
    p_workflow_run_id,
    'workflow_resumed',
    'user',
    jsonb_build_object(
      'reset_activity_run_ids', to_jsonb(v_reset_ids),
      'reset_count', v_reset_count,
      'resume_count', v_resume_count + 1
    )
  );

  RETURN jsonb_build_object(
    'workflow_run_id', p_workflow_run_id,
    'reset_count', v_reset_count,
    'resume_count', v_resume_count + 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resume_failed_activities(uuid) TO authenticated;
