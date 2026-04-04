-- Corrective migration: true conditional routing for document_processing_v1
-- Fixes prior linear extractor chain by introducing condition-aware edge evaluation
-- and a routed DAG with parallel image metadata/OCR branch.

CREATE OR REPLACE FUNCTION public.edge_condition_matches(
  p_condition_expr jsonb,
  p_context jsonb
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_value jsonb;
  v_item jsonb;
  v_matches boolean;
BEGIN
  IF p_condition_expr IS NULL OR p_condition_expr = '{}'::jsonb THEN
    RETURN true;
  END IF;

  IF p_context IS NULL THEN
    p_context := '{}'::jsonb;
  END IF;

  IF p_condition_expr ? 'context_equals' THEN
    FOR v_key, v_value IN
      SELECT key, value FROM jsonb_each(p_condition_expr->'context_equals')
    LOOP
      IF COALESCE(p_context->v_key, 'null'::jsonb) <> v_value THEN
        RETURN false;
      END IF;
    END LOOP;
  END IF;

  IF p_condition_expr ? 'context_not_equals' THEN
    FOR v_key, v_value IN
      SELECT key, value FROM jsonb_each(p_condition_expr->'context_not_equals')
    LOOP
      IF COALESCE(p_context->v_key, 'null'::jsonb) = v_value THEN
        RETURN false;
      END IF;
    END LOOP;
  END IF;

  IF p_condition_expr ? 'context_in' THEN
    FOR v_key, v_value IN
      SELECT key, value FROM jsonb_each(p_condition_expr->'context_in')
    LOOP
      IF jsonb_typeof(v_value) <> 'array' THEN
        RETURN false;
      END IF;

      v_matches := false;
      FOR v_item IN SELECT value FROM jsonb_array_elements(v_value)
      LOOP
        IF COALESCE(p_context->v_key, 'null'::jsonb) = v_item THEN
          v_matches := true;
          EXIT;
        END IF;
      END LOOP;

      IF NOT v_matches THEN
        RETURN false;
      END IF;
    END LOOP;
  END IF;

  IF p_condition_expr ? 'context_not_in' THEN
    FOR v_key, v_value IN
      SELECT key, value FROM jsonb_each(p_condition_expr->'context_not_in')
    LOOP
      IF jsonb_typeof(v_value) <> 'array' THEN
        RETURN false;
      END IF;

      FOR v_item IN SELECT value FROM jsonb_array_elements(v_value)
      LOOP
        IF COALESCE(p_context->v_key, 'null'::jsonb) = v_item THEN
          RETURN false;
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  IF p_condition_expr ? 'and' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_condition_expr->'and')
    LOOP
      IF NOT public.edge_condition_matches(v_item, p_context) THEN
        RETURN false;
      END IF;
    END LOOP;
  END IF;

  IF p_condition_expr ? 'or' THEN
    v_matches := false;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_condition_expr->'or')
    LOOP
      IF public.edge_condition_matches(v_item, p_context) THEN
        v_matches := true;
        EXIT;
      END IF;
    END LOOP;

    IF NOT v_matches THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
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
    'Reliability routing fix: conditional fan-out by detected file type with guarded fallback and parallel image branch',
    v_default_context,
    jsonb_build_object(
      'profile', 'stabilization-v3-routing-fix',
      'source_migration', '20260404201000',
      'notes', 'Replaces sequential extractor chain with condition-based branching'
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
    COALESCE(wa.metadata, '{}'::jsonb) || jsonb_build_object('profile', 'stabilization-v3-routing-fix')
  FROM public.workflow_activities wa
  WHERE wa.version_id = v_prev_version_id;

  WITH activity_map AS (
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
    fa.id,
    ta.id,
    'all'::public.edge_join_policy,
    e.condition_expr,
    '{}'::jsonb
  FROM (
    VALUES
      ('document.prepare_run', 'document.load_source', NULL::jsonb),
      ('document.load_source', 'document.compute_file_fingerprint', NULL::jsonb),
      ('document.compute_file_fingerprint', 'document.detect_file_type', NULL::jsonb),
      ('document.detect_file_type', 'document.persist_metadata.after_detect_type', NULL::jsonb),

      ('document.persist_metadata.after_detect_type', 'document.inspect_pdf_text_layer',
        '{"context_equals":{"normalized_file_category":"pdf"}}'::jsonb),
      ('document.inspect_pdf_text_layer', 'document.persist_metadata.after_pdf_inspection', NULL::jsonb),
      ('document.persist_metadata.after_pdf_inspection', 'document.extract_pdf_text',
        '{"context_equals":{"pdf_text_status":"HAS_SELECTABLE_TEXT"}}'::jsonb),
      ('document.persist_metadata.after_pdf_inspection', 'document.extract_text_fallback',
        '{"context_equals":{"pdf_text_status":"LIKELY_SCANNED"}}'::jsonb),

      ('document.persist_metadata.after_detect_type', 'document.extract_docx_text',
        '{"or":[{"context_equals":{"file_type":"docx"}},{"context_equals":{"mime_type":"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}}]}'::jsonb),
      ('document.persist_metadata.after_detect_type', 'document.extract_doc_text',
        '{"or":[{"context_equals":{"file_type":"doc"}},{"context_equals":{"mime_type":"application/msword"}}]}'::jsonb),
      ('document.persist_metadata.after_detect_type', 'document.extract_spreadsheet_text',
        '{"context_equals":{"normalized_file_category":"spreadsheet"}}'::jsonb),
      ('document.persist_metadata.after_detect_type', 'document.extract_presentation_text',
        '{"context_in":{"file_type":["pptx","ppt"]}}'::jsonb),
      ('document.persist_metadata.after_detect_type', 'document.extract_email_text',
        '{"context_in":{"file_type":["eml","msg"]}}'::jsonb),
      ('document.persist_metadata.after_detect_type', 'document.extract_plain_text_like_content',
        '{"context_in":{"file_type":["txt","md","rtf","xml","json","log"]}}'::jsonb),

      ('document.persist_metadata.after_detect_type', 'document.extract_image_metadata',
        '{"context_in":{"file_type":["jpg","jpeg","png"]}}'::jsonb),
      ('document.persist_metadata.after_detect_type', 'document.ocr_image',
        '{"context_in":{"file_type":["jpg","jpeg","png"]}}'::jsonb),

      ('document.persist_metadata.after_detect_type', 'document.extract_text_fallback',
        '{"context_not_in":{"file_type":["pdf","docx","doc","xls","xlsx","csv","pptx","ppt","eml","msg","txt","md","rtf","xml","json","log","jpg","jpeg","png"]}}'::jsonb),

      ('document.extract_pdf_text', 'document.normalize_output', NULL::jsonb),
      ('document.extract_docx_text', 'document.normalize_output', NULL::jsonb),
      ('document.extract_doc_text', 'document.normalize_output', NULL::jsonb),
      ('document.extract_spreadsheet_text', 'document.normalize_output', NULL::jsonb),
      ('document.extract_presentation_text', 'document.normalize_output', NULL::jsonb),
      ('document.extract_email_text', 'document.normalize_output', NULL::jsonb),
      ('document.extract_plain_text_like_content', 'document.normalize_output', NULL::jsonb),
      ('document.extract_image_metadata', 'document.normalize_output',
        '{"context_in":{"file_type":["jpg","jpeg","png"]}}'::jsonb),
      ('document.ocr_image', 'document.normalize_output',
        '{"context_in":{"file_type":["jpg","jpeg","png"]}}'::jsonb),
      ('document.extract_text_fallback', 'document.normalize_output', NULL::jsonb),

      ('document.normalize_output', 'document.persist_metadata.after_normalize', NULL::jsonb),
      ('document.persist_metadata.after_normalize', 'document.assess_quality', NULL::jsonb),
      ('document.assess_quality', 'document.persist_metadata.after_quality', NULL::jsonb),
      ('document.persist_metadata.after_quality', 'document.detect_language_and_stats', NULL::jsonb),
      ('document.detect_language_and_stats', 'document.persist_metadata.after_language_stats', NULL::jsonb),

      ('document.persist_metadata.after_language_stats', 'document.generate_summary', NULL::jsonb),
      ('document.generate_summary', 'document.build_search_index', NULL::jsonb),

      ('document.persist_metadata.after_language_stats', 'document.chunk_text', NULL::jsonb),
      ('document.chunk_text', 'document.generate_chunk_embeddings', NULL::jsonb),
      ('document.chunk_text', 'document.generate_chunk_questions', NULL::jsonb),

      ('document.build_search_index', 'document.finalize_document', NULL::jsonb),
      ('document.generate_chunk_embeddings', 'document.finalize_document', NULL::jsonb)
  ) AS e(from_key, to_key, condition_expr)
  JOIN activity_map fa ON fa.key = e.from_key
  JOIN activity_map ta ON ta.key = e.to_key;
END $$;