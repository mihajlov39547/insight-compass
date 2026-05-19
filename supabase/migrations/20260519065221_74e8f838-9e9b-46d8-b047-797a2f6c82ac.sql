
CREATE OR REPLACE FUNCTION public.get_workflow_dag(p_workflow_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_version_id uuid;
  v_def_key text;
  v_run_status text;
  v_nodes jsonb;
  v_edges jsonb;
BEGIN
  SELECT wr.user_id, wr.version_id, wd.key, wr.status::text
    INTO v_user_id, v_version_id, v_def_key, v_run_status
  FROM workflow_runs wr
  JOIN workflow_definitions wd ON wd.id = wr.workflow_definition_id
  WHERE wr.id = p_workflow_run_id;

  IF v_version_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to view this workflow run';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'key', wa.key,
    'name', wa.name,
    'is_entry', wa.is_entry,
    'is_terminal', wa.is_terminal,
    'is_optional', wa.is_optional,
    'handler_key', wa.handler_key,
    'status', COALESCE(ar.status::text, 'pending'),
    'attempt_count', COALESCE(ar.attempt_count, 0),
    'error_message', ar.error_message,
    'started_at', ar.started_at,
    'finished_at', ar.finished_at
  ) ORDER BY wa.key), '[]'::jsonb)
  INTO v_nodes
  FROM workflow_activities wa
  LEFT JOIN activity_runs ar
    ON ar.workflow_run_id = p_workflow_run_id
   AND ar.activity_id = wa.id
  WHERE wa.version_id = v_version_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'from', src.key,
    'to', dst.key
  )), '[]'::jsonb)
  INTO v_edges
  FROM workflow_edges we
  JOIN workflow_activities src ON src.id = we.from_activity_id
  JOIN workflow_activities dst ON dst.id = we.to_activity_id
  WHERE we.version_id = v_version_id;

  RETURN jsonb_build_object(
    'workflow_run_id', p_workflow_run_id,
    'workflow_key', v_def_key,
    'workflow_status', v_run_status,
    'nodes', v_nodes,
    'edges', v_edges
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_workflow_dag(uuid) TO authenticated;
