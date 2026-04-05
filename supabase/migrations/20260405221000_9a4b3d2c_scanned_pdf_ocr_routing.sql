-- Route scanned PDFs to Tesseract OCR activity and keep selectable PDFs on parser path.
-- Adds missing workflow activity row for document.ocr_pdf on current document_processing_v1 version.

DO $$
DECLARE
  v_definition_id uuid;
  v_version_id uuid;
  v_from_id uuid;
  v_to_extract_fallback_id uuid;
  v_to_extract_pdf_id uuid;
  v_to_normalize_id uuid;
  v_ocr_pdf_id uuid;
BEGIN
  SELECT id
  INTO v_definition_id
  FROM public.workflow_definitions
  WHERE key = 'document_processing_v1'
  LIMIT 1;

  IF v_definition_id IS NULL THEN
    RAISE NOTICE 'document_processing_v1 definition not found; skipping scanned PDF OCR routing migration';
    RETURN;
  END IF;

  SELECT id
  INTO v_version_id
  FROM public.workflow_definition_versions
  WHERE workflow_definition_id = v_definition_id
    AND is_current = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_version_id IS NULL THEN
    RAISE NOTICE 'No current version found for document_processing_v1; skipping';
    RETURN;
  END IF;

  SELECT id INTO v_from_id
  FROM public.workflow_activities
  WHERE version_id = v_version_id
    AND key = 'document.persist_metadata.after_pdf_inspection'
  LIMIT 1;

  SELECT id INTO v_to_extract_fallback_id
  FROM public.workflow_activities
  WHERE version_id = v_version_id
    AND key = 'document.extract_text_fallback'
  LIMIT 1;

  SELECT id INTO v_to_extract_pdf_id
  FROM public.workflow_activities
  WHERE version_id = v_version_id
    AND key = 'document.extract_pdf_text'
  LIMIT 1;

  SELECT id INTO v_to_normalize_id
  FROM public.workflow_activities
  WHERE version_id = v_version_id
    AND key = 'document.normalize_output'
  LIMIT 1;

  SELECT id INTO v_ocr_pdf_id
  FROM public.workflow_activities
  WHERE version_id = v_version_id
    AND key = 'document.ocr_pdf'
  LIMIT 1;

  IF v_ocr_pdf_id IS NULL THEN
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
      execution_priority,
      metadata
    ) VALUES (
      v_version_id,
      'document.ocr_pdf',
      'OCR PDF',
      'document.ocr_pdf',
      'Run OCR for scanned PDFs (Tesseract primary, external fallback optional)',
      false,
      false,
      false,
      false,
      2,
      10,
      2.0,
      120,
      73,
      jsonb_build_object('profile', 'scanned-pdf-ocr')
    )
    RETURNING id INTO v_ocr_pdf_id;
  END IF;

  IF v_from_id IS NULL OR v_to_normalize_id IS NULL OR v_ocr_pdf_id IS NULL THEN
    RAISE NOTICE 'Required activities missing for scanned PDF OCR rewiring; skipping';
    RETURN;
  END IF;

  -- Remove old scanned-PDF fallback route if present.
  IF v_to_extract_fallback_id IS NOT NULL THEN
    DELETE FROM public.workflow_edges
    WHERE version_id = v_version_id
      AND from_activity_id = v_from_id
      AND to_activity_id = v_to_extract_fallback_id
      AND condition_expr = '{"context_equals":{"pdf_text_status":"LIKELY_SCANNED"}}'::jsonb;
  END IF;

  -- Ensure selectable-PDF route remains parser-first.
  IF v_to_extract_pdf_id IS NOT NULL THEN
    INSERT INTO public.workflow_edges (
      version_id,
      from_activity_id,
      to_activity_id,
      join_policy,
      condition_expr,
      metadata
    )
    SELECT
      v_version_id,
      v_from_id,
      v_to_extract_pdf_id,
      'all'::public.edge_join_policy,
      '{"context_equals":{"pdf_text_status":"HAS_SELECTABLE_TEXT"}}'::jsonb,
      '{}'::jsonb
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.workflow_edges e
      WHERE e.version_id = v_version_id
        AND e.from_activity_id = v_from_id
        AND e.to_activity_id = v_to_extract_pdf_id
        AND e.condition_expr = '{"context_equals":{"pdf_text_status":"HAS_SELECTABLE_TEXT"}}'::jsonb
    );
  END IF;

  -- Route scanned PDFs to OCR.
  INSERT INTO public.workflow_edges (
    version_id,
    from_activity_id,
    to_activity_id,
    join_policy,
    condition_expr,
    metadata
  )
  SELECT
    v_version_id,
    v_from_id,
    v_ocr_pdf_id,
    'all'::public.edge_join_policy,
    '{"context_equals":{"pdf_text_status":"LIKELY_SCANNED"}}'::jsonb,
    '{}'::jsonb
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.workflow_edges e
    WHERE e.version_id = v_version_id
      AND e.from_activity_id = v_from_id
      AND e.to_activity_id = v_ocr_pdf_id
      AND e.condition_expr = '{"context_equals":{"pdf_text_status":"LIKELY_SCANNED"}}'::jsonb
  );

  -- Normalize OCR output through existing downstream path.
  INSERT INTO public.workflow_edges (
    version_id,
    from_activity_id,
    to_activity_id,
    join_policy,
    condition_expr,
    metadata
  )
  SELECT
    v_version_id,
    v_ocr_pdf_id,
    v_to_normalize_id,
    'all'::public.edge_join_policy,
    NULL,
    '{}'::jsonb
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.workflow_edges e
    WHERE e.version_id = v_version_id
      AND e.from_activity_id = v_ocr_pdf_id
      AND e.to_activity_id = v_to_normalize_id
      AND e.condition_expr IS NULL
  );
END $$;
