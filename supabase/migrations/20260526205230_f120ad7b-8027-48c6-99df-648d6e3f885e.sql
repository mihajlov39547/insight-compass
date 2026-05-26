UPDATE public.documents d
SET processing_status = 'completed', processing_error = NULL
FROM public.workflow_runs wr
WHERE wr.trigger_entity_type = 'document'
  AND wr.trigger_entity_id = d.id
  AND wr.status = 'completed'
  AND d.processing_status = 'generating_chunk_questions';