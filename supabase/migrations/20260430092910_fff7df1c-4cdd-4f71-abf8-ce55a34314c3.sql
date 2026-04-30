-- Fix PDF inspection → extract_pdf_text routing.
-- Inspection emits new diagnostic labels (INSPECTION_HAS_TEXT_LAYER,
-- INSPECTION_NO_TEXT_LAYER, INSPECTION_FAILED, NOT_PDF) but workflow edges
-- still required legacy labels (HAS_SELECTABLE_TEXT, LIKELY_SCANNED), so no
-- downstream activity was scheduled and PDFs got stuck in extracting_content.

DO $$
DECLARE
  v_definition_id uuid;
  v_version_id uuid;
  v_from_id uuid;
  v_to_extract_pdf_id uuid;
BEGIN
  SELECT id INTO v_definition_id
  FROM public.workflow_definitions
  WHERE key = 'document_processing_v1' LIMIT 1;
  IF v_definition_id IS NULL THEN RETURN; END IF;

  SELECT id INTO v_version_id
  FROM public.workflow_definition_versions
  WHERE workflow_definition_id = v_definition_id AND is_current = true
  ORDER BY created_at DESC LIMIT 1;
  IF v_version_id IS NULL THEN RETURN; END IF;

  SELECT id INTO v_from_id FROM public.workflow_activities
  WHERE version_id = v_version_id
    AND key = 'document.persist_metadata.after_pdf_inspection' LIMIT 1;

  SELECT id INTO v_to_extract_pdf_id FROM public.workflow_activities
  WHERE version_id = v_version_id
    AND key = 'document.extract_pdf_text' LIMIT 1;

  IF v_from_id IS NULL OR v_to_extract_pdf_id IS NULL THEN RETURN; END IF;

  -- Drop all legacy edges from this gate; recreate one that always proceeds
  -- to extract_pdf_text. The unpdf-based extractor handles all label cases
  -- and downstream stages decide whether OCR fallback is needed.
  DELETE FROM public.workflow_edges
  WHERE version_id = v_version_id AND from_activity_id = v_from_id;

  INSERT INTO public.workflow_edges (
    version_id, from_activity_id, to_activity_id, join_policy,
    condition_expr, metadata
  ) VALUES (
    v_version_id, v_from_id, v_to_extract_pdf_id, 'all'::public.edge_join_policy,
    jsonb_build_object(
      'context_in', jsonb_build_object(
        'pdf_text_status', jsonb_build_array(
          'INSPECTION_HAS_TEXT_LAYER',
          'INSPECTION_NO_TEXT_LAYER',
          'INSPECTION_FAILED',
          'HAS_SELECTABLE_TEXT',
          'LIKELY_SCANNED',
          'NOT_PDF'
        )
      )
    ),
    '{}'::jsonb
  );
END $$;

-- Recover documents currently stuck because of this bug: mark their
-- workflow_runs as failed and the document as failed so users can hit Retry.
UPDATE public.workflow_runs wr
SET status = 'failed',
    failure_reason = COALESCE(failure_reason,
      'Stalled after PDF inspection: routing fixed, please retry'),
    completed_at = COALESCE(completed_at, now())
WHERE wr.status = 'completed'
  AND wr.trigger_entity_type = 'document'
  AND EXISTS (
    SELECT 1 FROM public.activity_runs ar
    WHERE ar.workflow_run_id = wr.id
      AND ar.activity_key = 'document.extract_pdf_text'
      AND ar.status = 'pending'
  )
  AND EXISTS (
    SELECT 1 FROM public.activity_runs ar
    WHERE ar.workflow_run_id = wr.id
      AND ar.activity_key = 'document.persist_metadata.after_pdf_inspection'
      AND ar.status = 'completed'
  );

UPDATE public.documents d
SET processing_status = 'failed',
    processing_error = COALESCE(processing_error,
      'PDF processing stalled after inspection (fixed in routing patch). Please retry.')
WHERE d.processing_status = 'extracting_content'
  AND EXISTS (
    SELECT 1 FROM public.workflow_runs wr
    WHERE wr.trigger_entity_id = d.id
      AND wr.trigger_entity_type = 'document'
      AND wr.failure_reason = 'Stalled after PDF inspection: routing fixed, please retry'
  );
