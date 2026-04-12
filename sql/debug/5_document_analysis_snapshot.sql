-- 5_ document + analysis snapshot (did extraction produce text, quality, method?)
-- Replace <DOC_ID> before running.

select
  d.id as document_id,
  d.file_name,
  d.processing_status,
  d.processing_error,
  d.updated_at as document_updated_at,
  da.extracted_text is not null as has_extracted_text,
  length(coalesce(da.extracted_text, '')) as extracted_text_len,
  da.ocr_used,
  da.metadata_json->>'extractor_selected' as extractor_selected,
  da.metadata_json->>'extractor_status' as extractor_status,
  da.metadata_json->>'quality_reason' as quality_reason,
  da.metadata_json->>'last_completed_stage' as last_completed_stage,
  da.updated_at as analysis_updated_at
from public.documents d
left join public.document_analysis da on da.document_id = d.id
where d.id = '9640310f-42d8-4dd3-9b88-26af7ab2f1aa'::uuid;
