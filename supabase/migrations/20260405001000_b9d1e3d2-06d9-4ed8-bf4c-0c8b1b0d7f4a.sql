-- Conditional DAG reliability hardening
-- 1) Reachability helper for condition-aware workflows
-- 2) Runnable helper/scheduler update to respect reachable predecessor set
-- 3) document_processing_v1 version bump with PPTX-only presentation route

CREATE OR REPLACE FUNCTION public.workflow_reachable_activity_ids(
  p_workflow_run_id uuid
)
RETURNS TABLE(activity_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE
  wr AS (
    SELECT id, version_id, COALESCE(context, '{}'::jsonb) AS context
    FROM public.workflow_runs
    WHERE id = p_workflow_run_id
  ),
  reachable AS (
    SELECT wa.id AS activity_id
    FROM public.workflow_activities wa
    JOIN wr ON wr.version_id = wa.version_id
    WHERE wa.is_entry = true

    UNION

    SELECT e.to_activity_id AS activity_id
    FROM reachable r
    JOIN public.workflow_edges e
      ON e.from_activity_id = r.activity_id
    JOIN wr
      ON wr.version_id = e.version_id
    WHERE public.edge_condition_matches(e.condition_expr, wr.context)
  )
  SELECT DISTINCT reachable.activity_id
  FROM reachable;
$$;

CREATE OR REPLACE FUNCTION public.is_activity_runnable(
  p_workflow_run_id uuid,
  p_activity_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_context jsonb := '{}'::jsonb;
  v_pred record;
  v_pred_status public.activity_run_status;
BEGIN
  SELECT COALESCE(context, '{}'::jsonb)
  INTO v_context
  FROM public.workflow_runs
  WHERE id = p_workflow_run_id;

  FOR v_pred IN
    SELECT e.from_activity_id
    FROM public.workflow_edges e
    JOIN public.workflow_reachable_activity_ids(p_workflow_run_id) rr
      ON rr.activity_id = e.from_activity_id
    WHERE e.to_activity_id = p_activity_id
      AND public.edge_condition_matches(e.condition_expr, v_context)
  LOOP
    SELECT ar_pred.status
    INTO v_pred_status
    FROM public.activity_runs ar_pred
    WHERE ar_pred.workflow_run_id = p_workflow_run_id
      AND ar_pred.activity_id = v_pred.from_activity_id
    LIMIT 1;

    IF v_pred_status IS DISTINCT FROM 'completed'::public.activity_run_status
       AND v_pred_status IS DISTINCT FROM 'skipped'::public.activity_run_status THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_downstream_activities(
  p_workflow_run_id uuid,
  p_completed_activity_id uuid,
  p_actor text DEFAULT 'orchestrator'
)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_context jsonb := '{}'::jsonb;
  v_downstream_activity_id uuid;
  v_activity_run_id uuid;
  v_is_runnable boolean;
BEGIN
  SELECT COALESCE(context, '{}'::jsonb)
  INTO v_context
  FROM public.workflow_runs
  WHERE id = p_workflow_run_id;

  FOR v_downstream_activity_id IN
    SELECT DISTINCT e.to_activity_id
    FROM public.workflow_edges e
    JOIN public.activity_runs ar_from
      ON ar_from.activity_id = e.from_activity_id
      AND ar_from.workflow_run_id = p_workflow_run_id
    JOIN public.workflow_reachable_activity_ids(p_workflow_run_id) rr
      ON rr.activity_id = e.to_activity_id
    WHERE e.from_activity_id = p_completed_activity_id
      AND public.edge_condition_matches(e.condition_expr, v_context)
  LOOP
    SELECT public.is_activity_runnable(p_workflow_run_id, v_downstream_activity_id)
    INTO v_is_runnable;

    IF v_is_runnable THEN
      SELECT ar.id INTO v_activity_run_id
      FROM public.activity_runs ar
      WHERE ar.workflow_run_id = p_workflow_run_id
        AND ar.activity_id = v_downstream_activity_id
        AND ar.status = 'pending'
      LIMIT 1;

      IF v_activity_run_id IS NOT NULL THEN
        UPDATE public.activity_runs
        SET status = 'queued',
            scheduled_at = now(),
            updated_at = now()
        WHERE id = v_activity_run_id;

        INSERT INTO public.workflow_events (workflow_run_id, activity_run_id, event_type, actor, details)
        VALUES (
          p_workflow_run_id,
          v_activity_run_id,
          'activity_queued',
          p_actor,
          jsonb_build_object(
            'triggered_by_activity_id', p_completed_activity_id,
            'downstream_activity_id', v_downstream_activity_id
          )
        );

        RETURN NEXT v_activity_run_id;
      END IF;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

DO $$
DECLARE
  v_definition_id uuid;
  v_prev_version_id uuid;
  v_new_version_id uuid;
  v_next_version integer;
  v_default_context jsonb := '{}'::jsonb;
BEGIN
  SELECT id
  INTO v_definition_id
  FROM public.workflow_definitions
  WHERE key = 'document_processing_v1'
  LIMIT 1;

  IF v_definition_id IS NULL THEN
    RAISE EXCEPTION 'document_processing_v1 definition not found';
  END IF;

  SELECT id, COALESCE(default_context, '{}'::jsonb)
  INTO v_prev_version_id, v_default_context
  FROM public.workflow_definition_versions
  WHERE workflow_definition_id = v_definition_id
    AND is_current = true
  ORDER BY version DESC
  LIMIT 1;

  IF v_prev_version_id IS NULL THEN
    RAISE EXCEPTION 'No current version found for document_processing_v1';
  END IF;

  UPDATE public.workflow_definition_versions
  SET is_current = false
  WHERE workflow_definition_id = v_definition_id
    AND is_current = true;

  SELECT COALESCE(MAX(version), 0) + 1
  INTO v_next_version
  FROM public.workflow_definition_versions
  WHERE workflow_definition_id = v_definition_id;

  INSERT INTO public.workflow_definition_versions (
    workflow_definition_id,
    version,
    is_current,
    description,
    default_context,
    metadata
  ) VALUES (
    v_definition_id,
    v_next_version,
    true,
    'Reachability-aware conditional routing hardening (PPTX-first active path)',
    v_default_context,
    jsonb_build_object(
      'profile', 'stabilization-v4-reachability',
      'source_migration', '20260405001000',
      'notes', 'Finalization and runnable checks ignore non-reachable branch activities'
    )
  )
  RETURNING id INTO v_new_version_id;

  INSERT INTO public.workflow_activities (
    version_id,
    key,
    name,
    handler_key,
    description,
    is_terminal,
    is_entry,
    is_optional,
    writes_output,
    retry_max_attempts,
    retry_backoff_seconds,
    retry_backoff_multiplier,
    timeout_seconds,
    concurrency_key,
    execution_priority,
    metadata
  )
  SELECT
    v_new_version_id,
    wa.key,
    wa.name,
    wa.handler_key,
    wa.description,
    wa.is_terminal,
    wa.is_entry,
    wa.is_optional,
    wa.writes_output,
    wa.retry_max_attempts,
    wa.retry_backoff_seconds,
    wa.retry_backoff_multiplier,
    wa.timeout_seconds,
    wa.concurrency_key,
    wa.execution_priority,
    COALESCE(wa.metadata, '{}'::jsonb) || jsonb_build_object('profile', 'stabilization-v4-reachability')
  FROM public.workflow_activities wa
  WHERE wa.version_id = v_prev_version_id;

  WITH old_map AS (
    SELECT id, key
    FROM public.workflow_activities
    WHERE version_id = v_prev_version_id
  ),
  new_map AS (
    SELECT id, key
    FROM public.workflow_activities
    WHERE version_id = v_new_version_id
  )
  INSERT INTO public.workflow_edges (
    version_id,
    from_activity_id,
    to_activity_id,
    join_policy,
    condition_expr,
    metadata
  )
  SELECT
    v_new_version_id,
    n_from.id,
    n_to.id,
    e.join_policy,
    e.condition_expr,
    '{}'::jsonb
  FROM public.workflow_edges e
  JOIN old_map o_from ON o_from.id = e.from_activity_id
  JOIN old_map o_to ON o_to.id = e.to_activity_id
  JOIN new_map n_from ON n_from.key = o_from.key
  JOIN new_map n_to ON n_to.key = o_to.key
  WHERE e.version_id = v_prev_version_id;

  -- PPTX-first safe path: keep PPT out of active presentation route
  UPDATE public.workflow_edges e
  SET condition_expr = '{"or":[{"context_equals":{"file_type":"pptx"}},{"context_equals":{"mime_type":"application/vnd.openxmlformats-officedocument.presentationml.presentation"}}]}'::jsonb
  FROM public.workflow_activities fa, public.workflow_activities ta
  WHERE e.version_id = v_new_version_id
    AND e.from_activity_id = fa.id
    AND e.to_activity_id = ta.id
    AND fa.version_id = v_new_version_id
    AND ta.version_id = v_new_version_id
    AND fa.key = 'document.persist_metadata.after_detect_type'
    AND ta.key = 'document.extract_presentation_text';

  -- Ensure PPT legacy routes to fallback path instead of active presentation path
  UPDATE public.workflow_edges e
  SET condition_expr = '{"context_not_in":{"file_type":["pdf","docx","doc","xls","xlsx","csv","pptx","eml","msg","txt","md","rtf","xml","json","log","jpg","jpeg","png"]}}'::jsonb
  FROM public.workflow_activities fa, public.workflow_activities ta
  WHERE e.version_id = v_new_version_id
    AND e.from_activity_id = fa.id
    AND e.to_activity_id = ta.id
    AND fa.version_id = v_new_version_id
    AND ta.version_id = v_new_version_id
    AND fa.key = 'document.persist_metadata.after_detect_type'
    AND ta.key = 'document.extract_text_fallback';
END $$;