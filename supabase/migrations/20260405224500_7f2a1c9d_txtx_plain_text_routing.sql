-- Add TXTX extension to plain-text-like routing for current document_processing_v1 workflow version.

DO $$
DECLARE
  v_definition_id uuid;
  v_version_id uuid;
BEGIN
  SELECT id
  INTO v_definition_id
  FROM public.workflow_definitions
  WHERE key = 'document_processing_v1'
  LIMIT 1;

  IF v_definition_id IS NULL THEN
    RAISE NOTICE 'document_processing_v1 definition not found; skipping txtx routing migration';
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

  -- Route txtx through plain-text-like extractor branch.
  UPDATE public.workflow_edges e
  SET condition_expr = '{"context_in":{"file_type":["txt","txtx","md","rtf","xml","json","log"]}}'::jsonb
  FROM public.workflow_activities fa, public.workflow_activities ta
  WHERE e.version_id = v_version_id
    AND e.from_activity_id = fa.id
    AND e.to_activity_id = ta.id
    AND fa.version_id = v_version_id
    AND ta.version_id = v_version_id
    AND fa.key = 'document.persist_metadata.after_detect_type'
    AND ta.key = 'document.extract_plain_text_like_content';

  -- Exclude txtx from generic fallback routing.
  UPDATE public.workflow_edges e
  SET condition_expr = '{"context_not_in":{"file_type":["pdf","docx","doc","xls","xlsx","csv","pptx","eml","msg","txt","txtx","md","rtf","xml","json","log","jpg","jpeg","png"]}}'::jsonb
  FROM public.workflow_activities fa, public.workflow_activities ta
  WHERE e.version_id = v_version_id
    AND e.from_activity_id = fa.id
    AND e.to_activity_id = ta.id
    AND fa.version_id = v_version_id
    AND ta.version_id = v_version_id
    AND fa.key = 'document.persist_metadata.after_detect_type'
    AND ta.key = 'document.extract_text_fallback';
END $$;
