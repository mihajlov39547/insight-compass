
CREATE OR REPLACE FUNCTION public.get_document_processing_status(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
  v_doc record;
  v_workflow_run record;
  v_activities jsonb;
  v_running jsonb;
  v_completed jsonb;
  v_failed jsonb;
  v_last_completed jsonb;
  v_current_stage text;
  v_progress_pct integer;
  v_total_activities integer;
  v_completed_count integer;
  v_chunk_count bigint;
  v_embedded_count bigint;
  v_question_count bigint;
  v_embedded_question_count bigint;
  v_has_extracted_text boolean;
  v_has_summary boolean;
  v_has_search_index boolean;
  v_elapsed_seconds numeric;
  v_warnings jsonb;
BEGIN
  -- Load document
  SELECT id, processing_status, processing_error, summary, detected_language,
         word_count, char_count, retry_count, created_at
  INTO v_doc
  FROM public.documents
  WHERE id = p_document_id AND user_id = auth.uid();

  IF v_doc IS NULL THEN
    RETURN jsonb_build_object('error', 'document_not_found');
  END IF;

  -- Find latest workflow run for this document
  SELECT id, status, started_at, completed_at, failure_reason, context, created_at
  INTO v_workflow_run
  FROM public.workflow_runs
  WHERE trigger_entity_type = 'document'
    AND trigger_entity_id = p_document_id
    AND user_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 1;

  -- If no workflow run, return basic document status
  IF v_workflow_run IS NULL THEN
    RETURN jsonb_build_object(
      'documentStatus', v_doc.processing_status,
      'workflowStatus', null,
      'currentStage', v_doc.processing_status,
      'runningActivities', '[]'::jsonb,
      'completedActivities', '[]'::jsonb,
      'failedActivities', '[]'::jsonb,
      'lastCompletedActivity', null,
      'elapsedSeconds', null,
      'progressPercent', CASE WHEN v_doc.processing_status = 'completed' THEN 100 ELSE 0 END,
      'readiness', jsonb_build_object(
        'textExtracted', v_doc.processing_status = 'completed',
        'languageDetected', v_doc.detected_language IS NOT NULL,
        'summaryReady', v_doc.summary IS NOT NULL,
        'keywordSearchReady', v_doc.processing_status = 'completed',
        'semanticSearchReady', false,
        'hybridReady', false,
        'groundedChatReady', false,
        'questionEnrichmentReady', false
      ),
      'metrics', jsonb_build_object(
        'chunkCount', 0,
        'embeddingCount', 0,
        'embeddingCoverage', 0,
        'questionCount', 0
      ),
      'warnings', '[]'::jsonb,
      'workflowRunId', null,
      'retryCount', v_doc.retry_count
    );
  END IF;

  -- Get activity runs with reachability filtering
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'activityKey', ar.activity_key,
        'activityName', ar.activity_name,
        'handlerKey', ar.handler_key,
        'status', ar.status,
        'isOptional', ar.is_optional,
        'startedAt', ar.started_at,
        'finishedAt', ar.finished_at,
        'errorMessage', ar.error_message,
        'attemptCount', ar.attempt_count,
        'durationMs', CASE
          WHEN ar.started_at IS NOT NULL AND ar.finished_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (ar.finished_at - ar.started_at)) * 1000
          WHEN ar.started_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (now() - ar.started_at)) * 1000
          ELSE null
        END
      ) ORDER BY ar.scheduled_at ASC NULLS LAST, ar.created_at ASC
    ), '[]'::jsonb)
  INTO v_activities
  FROM public.activity_runs ar
  WHERE ar.workflow_run_id = v_workflow_run.id
    AND ar.activity_id IN (
      SELECT ra.activity_id FROM public.workflow_reachable_activity_ids(v_workflow_run.id) ra
    );

  -- Running activities
  SELECT COALESCE(jsonb_agg(a), '[]'::jsonb)
  INTO v_running
  FROM jsonb_array_elements(v_activities) a
  WHERE a->>'status' IN ('running', 'claimed');

  -- Completed activities
  SELECT COALESCE(jsonb_agg(a ORDER BY (a->>'finishedAt') ASC), '[]'::jsonb)
  INTO v_completed
  FROM jsonb_array_elements(v_activities) a
  WHERE a->>'status' = 'completed';

  -- Failed activities
  SELECT COALESCE(jsonb_agg(a), '[]'::jsonb)
  INTO v_failed
  FROM jsonb_array_elements(v_activities) a
  WHERE a->>'status' = 'failed';

  -- Last completed
  SELECT a INTO v_last_completed
  FROM jsonb_array_elements(v_completed) a
  ORDER BY (a->>'finishedAt') DESC
  LIMIT 1;

  -- Counts for progress
  SELECT jsonb_array_length(v_activities) INTO v_total_activities;
  SELECT jsonb_array_length(v_completed) INTO v_completed_count;

  -- Progress percentage
  IF v_total_activities > 0 THEN
    v_progress_pct := LEAST(100, ROUND((v_completed_count::numeric / v_total_activities::numeric) * 100));
  ELSE
    v_progress_pct := 0;
  END IF;

  IF v_workflow_run.status IN ('completed', 'failed', 'cancelled', 'timed_out') THEN
    IF v_workflow_run.status = 'completed' THEN v_progress_pct := 100; END IF;
  END IF;

  -- Current stage derivation
  IF v_doc.processing_status IN ('completed', 'failed') THEN
    v_current_stage := v_doc.processing_status;
  ELSIF jsonb_array_length(v_running) > 0 THEN
    v_current_stage := v_running->0->>'activityKey';
  ELSIF v_last_completed IS NOT NULL THEN
    v_current_stage := 'after:' || (v_last_completed->>'activityKey');
  ELSE
    v_current_stage := 'queued';
  END IF;

  -- Elapsed seconds
  IF v_workflow_run.started_at IS NOT NULL THEN
    IF v_workflow_run.completed_at IS NOT NULL THEN
      v_elapsed_seconds := EXTRACT(EPOCH FROM (v_workflow_run.completed_at - v_workflow_run.started_at));
    ELSE
      v_elapsed_seconds := EXTRACT(EPOCH FROM (now() - v_workflow_run.started_at));
    END IF;
  END IF;

  -- Chunk/embedding stats
  SELECT COALESCE(COUNT(*), 0), COALESCE(COUNT(dc.embedding), 0)
  INTO v_chunk_count, v_embedded_count
  FROM public.document_chunks dc
  WHERE dc.document_id = p_document_id AND dc.user_id = auth.uid();

  -- Question stats
  SELECT COALESCE(COUNT(*), 0), COALESCE(COUNT(dcq.embedding), 0)
  INTO v_question_count, v_embedded_question_count
  FROM public.document_chunk_questions dcq
  WHERE dcq.document_id = p_document_id AND dcq.user_id = auth.uid();

  -- Text extraction check
  SELECT EXISTS(
    SELECT 1 FROM public.document_analysis da
    WHERE da.document_id = p_document_id AND da.user_id = auth.uid()
    AND da.extracted_text IS NOT NULL AND length(da.extracted_text) > 0
  ) INTO v_has_extracted_text;

  -- Search index check
  SELECT EXISTS(
    SELECT 1 FROM public.document_analysis da
    WHERE da.document_id = p_document_id AND da.user_id = auth.uid()
    AND da.indexed_at IS NOT NULL
  ) INTO v_has_search_index;

  v_has_summary := v_doc.summary IS NOT NULL;

  -- Warnings
  v_warnings := '[]'::jsonb;
  IF v_doc.processing_error IS NOT NULL THEN
    v_warnings := v_warnings || jsonb_build_array(v_doc.processing_error);
  END IF;
  IF v_workflow_run.failure_reason IS NOT NULL THEN
    v_warnings := v_warnings || jsonb_build_array(v_workflow_run.failure_reason);
  END IF;

  -- Build result
  v_result := jsonb_build_object(
    'documentStatus', v_doc.processing_status,
    'workflowStatus', v_workflow_run.status,
    'workflowRunId', v_workflow_run.id,
    'currentStage', v_current_stage,
    'runningActivities', v_running,
    'completedActivities', v_completed,
    'failedActivities', v_failed,
    'lastCompletedActivity', v_last_completed,
    'elapsedSeconds', v_elapsed_seconds,
    'progressPercent', v_progress_pct,
    'startedAt', v_workflow_run.started_at,
    'completedAt', v_workflow_run.completed_at,
    'retryCount', v_doc.retry_count,
    'readiness', jsonb_build_object(
      'textExtracted', v_has_extracted_text,
      'languageDetected', v_doc.detected_language IS NOT NULL,
      'summaryReady', v_has_summary,
      'keywordSearchReady', v_has_search_index,
      'semanticSearchReady', v_chunk_count > 0 AND v_embedded_count = v_chunk_count,
      'hybridReady', v_has_search_index AND v_chunk_count > 0 AND v_embedded_count = v_chunk_count,
      'groundedChatReady', v_chunk_count > 0 AND v_embedded_count = v_chunk_count,
      'questionEnrichmentReady', v_question_count > 0 AND v_embedded_question_count = v_question_count
    ),
    'metrics', jsonb_build_object(
      'chunkCount', v_chunk_count,
      'embeddingCount', v_embedded_count,
      'embeddingCoverage', CASE WHEN v_chunk_count > 0 THEN ROUND((v_embedded_count::numeric / v_chunk_count::numeric) * 100) ELSE 0 END,
      'questionCount', v_question_count,
      'embeddedQuestionCount', v_embedded_question_count
    ),
    'warnings', v_warnings
  );

  RETURN v_result;
END;
$$;
