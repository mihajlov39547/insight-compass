
CREATE OR REPLACE FUNCTION public.reset_resource_for_retry(
  p_entity_type text,
  p_entity_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_cancelled_runs int := 0;
  v_cancelled_acts int := 0;
  v_deleted_chunks int := 0;
  v_deleted_qs     int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;

  IF p_entity_type NOT IN ('document', 'resource_link') THEN
    RAISE EXCEPTION 'unsupported entity_type: %', p_entity_type USING ERRCODE = '22023';
  END IF;

  -- Ownership check + per-type cleanup
  IF p_entity_type = 'document' THEN
    SELECT user_id INTO v_owner FROM public.documents WHERE id = p_entity_id;
    IF v_owner IS NULL THEN
      RAISE EXCEPTION 'document not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_owner <> v_caller THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    WITH d AS (DELETE FROM public.document_chunk_questions WHERE document_id = p_entity_id RETURNING 1)
      SELECT count(*) INTO v_deleted_qs FROM d;
    WITH d AS (DELETE FROM public.document_chunks WHERE document_id = p_entity_id RETURNING 1)
      SELECT count(*) INTO v_deleted_chunks FROM d;
    DELETE FROM public.document_analysis WHERE document_id = p_entity_id;

    UPDATE public.documents
       SET processing_status = 'uploaded',
           processing_error  = NULL,
           summary           = NULL,
           detected_language = NULL,
           char_count        = NULL,
           word_count        = NULL,
           page_count        = NULL,
           retry_count       = COALESCE(retry_count, 0) + 1,
           last_retry_at     = now(),
           updated_at        = now()
     WHERE id = p_entity_id;

  ELSIF p_entity_type = 'resource_link' THEN
    SELECT user_id INTO v_owner FROM public.resource_links WHERE id = p_entity_id;
    IF v_owner IS NULL THEN
      RAISE EXCEPTION 'resource_link not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_owner <> v_caller THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    WITH d AS (DELETE FROM public.link_transcript_chunk_questions WHERE resource_link_id = p_entity_id RETURNING 1)
      SELECT count(*) INTO v_deleted_qs FROM d;
    WITH d AS (DELETE FROM public.link_transcript_chunks WHERE resource_link_id = p_entity_id RETURNING 1)
      SELECT count(*) INTO v_deleted_chunks FROM d;

    UPDATE public.resource_links
       SET transcript_status     = 'pending',
           transcript_error      = NULL,
           transcript_updated_at = NULL,
           metadata = COALESCE(metadata, '{}'::jsonb)
                       #- '{transcript,_text_stash}'
                       #- '{transcript,error}'
                       #- '{transcript,debug}'
                       #- '{summary}',
           updated_at = now()
     WHERE id = p_entity_id;
  END IF;

  -- Cancel any active workflow runs for this entity
  WITH cancelled AS (
    UPDATE public.workflow_runs
       SET status        = 'cancelled',
           completed_at  = COALESCE(completed_at, now()),
           updated_at    = now(),
           failure_reason = COALESCE(failure_reason, 'superseded_by_retry')
     WHERE trigger_entity_type = p_entity_type
       AND trigger_entity_id   = p_entity_id
       AND status IN ('pending', 'running')
    RETURNING id
  )
  SELECT count(*) INTO v_cancelled_runs FROM cancelled;

  -- Cancel non-terminal activity runs in those workflows
  WITH cancelled_acts AS (
    UPDATE public.activity_runs ar
       SET status      = 'cancelled',
           finished_at = COALESCE(ar.finished_at, now()),
           updated_at  = now()
      FROM public.workflow_runs wr
     WHERE ar.workflow_run_id = wr.id
       AND wr.trigger_entity_type = p_entity_type
       AND wr.trigger_entity_id   = p_entity_id
       AND ar.status IN ('pending','queued','claimed','running','waiting_retry')
    RETURNING ar.id
  )
  SELECT count(*) INTO v_cancelled_acts FROM cancelled_acts;

  RETURN jsonb_build_object(
    'ok', true,
    'entity_type', p_entity_type,
    'entity_id',   p_entity_id,
    'cancelled_workflow_runs', v_cancelled_runs,
    'cancelled_activity_runs', v_cancelled_acts,
    'deleted_chunks', v_deleted_chunks,
    'deleted_questions', v_deleted_qs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reset_resource_for_retry(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_resource_for_retry(text, uuid) TO authenticated;
