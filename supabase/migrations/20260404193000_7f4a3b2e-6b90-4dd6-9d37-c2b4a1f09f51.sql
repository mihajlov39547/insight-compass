-- Document workflow stabilization v2
-- Goal: prevent extraction stalls by introducing deterministic, type-aware pre-extraction routing
-- while keeping the workflow engine generic and preserving existing schema.

DO $$
DECLARE
  v_definition_id uuid;
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
    INSERT INTO public.workflow_definitions (
      key,
      name,
      description,
      status,
      metadata
    ) VALUES (
      'document_processing_v1',
      'Document Processing v1',
      'Type-aware document processing with deterministic extraction routing and checkpoint persistence',
      'active',
      jsonb_build_object('source', 'migration_20260404193000')
    )
    RETURNING id INTO v_definition_id;
  END IF;

  SELECT default_context
  INTO v_default_context
  FROM public.workflow_definition_versions
  WHERE workflow_definition_id = v_definition_id
    AND is_current = true
  ORDER BY version DESC
  LIMIT 1;

  v_default_context := COALESCE(v_default_context, '{}'::jsonb);

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
    'Reliability-focused DAG with early type detection, checkpoint persistence, and deterministic extraction paths',
    v_default_context,
    jsonb_build_object(
      'profile', 'stabilization-v2',
      'document_workflow_key', 'document_processing_v1',
      'notes', 'OCR PDF remains guarded out of critical path'
    )
  )
  RETURNING id INTO v_new_version_id;

  INSERT INTO public.workflow_activities (
    version_id,
    key,
    name,
    handler_key,
    description,
    is_entry,
    is_terminal,
    is_optional,
    writes_output,
    retry_max_attempts,
    retry_backoff_seconds,
    retry_backoff_multiplier,
    timeout_seconds,
    execution_priority,
    metadata
  )
  SELECT
    v_new_version_id,
    a.key,
    a.name,
    a.handler_key,
    a.description,
    a.is_entry,
    a.is_terminal,
    a.is_optional,
    true,
    a.retry_max_attempts,
    a.retry_backoff_seconds,
    a.retry_backoff_multiplier,
    a.timeout_seconds,
    a.execution_priority,
    jsonb_build_object('profile', 'stabilization-v2')
  FROM (
    VALUES
      ('document.prepare_run', 'Prepare Run', 'document.prepare_run', 'Initialize run and retry counters', true, false, false, 2, 5, 2.0::numeric, 20, 100),
      ('document.load_source', 'Load Source', 'document.load_source', 'Verify source object availability', false, false, false, 2, 5, 2.0::numeric, 30, 95),
      ('document.compute_file_fingerprint', 'Compute Fingerprint', 'document.compute_file_fingerprint', 'Compute SHA-256 for diagnostics and idempotent analysis checkpoints', false, false, false, 2, 5, 2.0::numeric, 30, 90),
      ('document.detect_file_type', 'Detect File Type', 'document.detect_file_type', 'Detect normalized file category before extraction', false, false, false, 2, 5, 2.0::numeric, 20, 85),
      ('document.persist_metadata.after_detect_type', 'Persist Metadata After Type Detection', 'document.persist_analysis_metadata', 'Persist routing and type-detection checkpoint metadata', false, false, false, 2, 5, 2.0::numeric, 20, 80),
      ('document.inspect_pdf_text_layer', 'Inspect PDF Text Layer', 'document.inspect_pdf_text_layer', 'Inspect whether PDF has selectable text before OCR/extraction strategy', false, false, false, 2, 5, 2.0::numeric, 45, 78),
      ('document.persist_metadata.after_pdf_inspection', 'Persist Metadata After PDF Inspection', 'document.persist_analysis_metadata', 'Persist PDF text-layer inspection checkpoint metadata', false, false, false, 2, 5, 2.0::numeric, 20, 76),
      ('document.extract_pdf_text', 'Extract PDF Text', 'document.extract_pdf_text', 'PDF parser-first extraction path', false, false, false, 2, 10, 2.0::numeric, 90, 74),
      ('document.extract_docx_text', 'Extract DOCX Text', 'document.extract_docx_text', 'Dedicated DOCX extraction path', false, false, false, 2, 10, 2.0::numeric, 60, 72),
      ('document.extract_doc_text', 'Extract DOC Text', 'document.extract_doc_text', 'Dedicated legacy DOC extraction path', false, false, false, 2, 10, 2.0::numeric, 60, 70),
      ('document.extract_spreadsheet_text', 'Extract Spreadsheet Text', 'document.extract_spreadsheet_text', 'Dedicated spreadsheet extraction path for XLS/XLSX/CSV', false, false, false, 2, 10, 2.0::numeric, 60, 68),
      ('document.extract_presentation_text', 'Extract Presentation Text', 'document.extract_presentation_text', 'Dedicated presentation extraction path (PPTX primary)', false, false, false, 2, 10, 2.0::numeric, 60, 66),
      ('document.extract_email_text', 'Extract Email Text', 'document.extract_email_text', 'Dedicated email extraction path (EML/MSG parser-first)', false, false, false, 2, 10, 2.0::numeric, 60, 64),
      ('document.extract_plain_text_like_content', 'Extract Plain Text-Like Content', 'document.extract_plain_text_like_content', 'Extraction path for TXT/MD/RTF/XML/JSON/LOG and similar text formats', false, false, false, 2, 10, 2.0::numeric, 40, 62),
      ('document.extract_image_metadata', 'Extract Image Metadata', 'document.extract_image_metadata', 'Extract deterministic image metadata (width/height/format)', false, false, false, 2, 5, 2.0::numeric, 20, 60),
      ('document.ocr_image', 'OCR Image', 'document.ocr_image', 'Image OCR path for JPG/JPEG/PNG and related formats', false, false, false, 2, 10, 2.0::numeric, 90, 58),
      ('document.extract_text_fallback', 'Extract Text Fallback', 'document.extract_text', 'Generic fallback extraction for unknown/unclassified types only', false, false, false, 2, 10, 2.0::numeric, 90, 56),
      ('document.normalize_output', 'Normalize Technical Analysis Output', 'document.normalize_technical_analysis_output', 'Normalize extraction payloads into stable downstream shape', false, false, false, 2, 5, 2.0::numeric, 30, 54),
      ('document.persist_metadata.after_normalize', 'Persist Metadata After Normalization', 'document.persist_analysis_metadata', 'Persist normalized extraction checkpoint metadata', false, false, false, 2, 5, 2.0::numeric, 20, 52),
      ('document.assess_quality', 'Assess Quality', 'document.assess_quality', 'Apply quality gate on extracted/normalized text', false, false, false, 2, 10, 2.0::numeric, 25, 50),
      ('document.persist_metadata.after_quality', 'Persist Metadata After Quality', 'document.persist_analysis_metadata', 'Persist quality checkpoint metadata', false, false, false, 2, 5, 2.0::numeric, 20, 48),
      ('document.detect_language_and_stats', 'Detect Language and Stats', 'document.detect_language_and_stats', 'Detect language/script and compute text stats', false, false, false, 2, 10, 2.0::numeric, 30, 46),
      ('document.persist_metadata.after_language_stats', 'Persist Metadata After Language/Stats', 'document.persist_analysis_metadata', 'Persist language/statistics checkpoint metadata', false, false, false, 2, 5, 2.0::numeric, 20, 44),
      ('document.generate_summary', 'Generate Summary', 'document.generate_summary', 'Generate optional document summary', false, false, false, 2, 15, 2.0::numeric, 60, 30),
      ('document.build_search_index', 'Build Search Index', 'document.build_search_index', 'Build normalized keyword search payload/indexing metadata', false, false, false, 2, 10, 2.0::numeric, 40, 28),
      ('document.chunk_text', 'Chunk Text', 'document.chunk_text', 'Create retrieval chunks exactly once for downstream embedding/questions', false, false, false, 2, 10, 2.0::numeric, 40, 26),
      ('document.generate_chunk_embeddings', 'Generate Chunk Embeddings', 'document.generate_chunk_embeddings', 'Generate chunk embeddings for semantic retrieval', false, false, false, 2, 15, 2.0::numeric, 90, 24),
      ('document.generate_chunk_questions', 'Generate Chunk Questions', 'document.generate_chunk_questions', 'Optional grounded question generation per chunk', false, false, true, 2, 15, 2.0::numeric, 120, 22),
      ('document.finalize_document', 'Finalize Document', 'document.finalize_document', 'Finalize document status and workflow terminalization', false, true, false, 2, 5, 2.0::numeric, 20, 10)
  ) AS a(
    key,
    name,
    handler_key,
    description,
    is_entry,
    is_terminal,
    is_optional,
    retry_max_attempts,
    retry_backoff_seconds,
    retry_backoff_multiplier,
    timeout_seconds,
    execution_priority
  );

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
    NULL,
    '{}'::jsonb
  FROM (
    VALUES
      ('document.prepare_run', 'document.load_source'),
      ('document.load_source', 'document.compute_file_fingerprint'),
      ('document.compute_file_fingerprint', 'document.detect_file_type'),
      ('document.detect_file_type', 'document.persist_metadata.after_detect_type'),
      ('document.persist_metadata.after_detect_type', 'document.inspect_pdf_text_layer'),
      ('document.inspect_pdf_text_layer', 'document.persist_metadata.after_pdf_inspection'),
      ('document.persist_metadata.after_pdf_inspection', 'document.extract_pdf_text'),
      ('document.extract_pdf_text', 'document.extract_docx_text'),
      ('document.extract_docx_text', 'document.extract_doc_text'),
      ('document.extract_doc_text', 'document.extract_spreadsheet_text'),
      ('document.extract_spreadsheet_text', 'document.extract_presentation_text'),
      ('document.extract_presentation_text', 'document.extract_email_text'),
      ('document.extract_email_text', 'document.extract_plain_text_like_content'),
      ('document.extract_plain_text_like_content', 'document.extract_image_metadata'),
      ('document.extract_image_metadata', 'document.ocr_image'),
      ('document.ocr_image', 'document.extract_text_fallback'),
      ('document.extract_text_fallback', 'document.normalize_output'),
      ('document.normalize_output', 'document.persist_metadata.after_normalize'),
      ('document.persist_metadata.after_normalize', 'document.assess_quality'),
      ('document.assess_quality', 'document.persist_metadata.after_quality'),
      ('document.persist_metadata.after_quality', 'document.detect_language_and_stats'),
      ('document.detect_language_and_stats', 'document.persist_metadata.after_language_stats'),
      ('document.persist_metadata.after_language_stats', 'document.generate_summary'),
      ('document.persist_metadata.after_language_stats', 'document.chunk_text'),
      ('document.generate_summary', 'document.build_search_index'),
      ('document.chunk_text', 'document.generate_chunk_embeddings'),
      ('document.chunk_text', 'document.generate_chunk_questions'),
      ('document.build_search_index', 'document.finalize_document'),
      ('document.generate_chunk_embeddings', 'document.finalize_document')
  ) AS e(from_key, to_key)
  JOIN activity_map fa ON fa.key = e.from_key
  JOIN activity_map ta ON ta.key = e.to_key;
END $$;