-- 5_ document + document_analysis extraction snapshot
-- DOC ID prefilled: 4b6f1064-f06f-4f98-95b9-3b1b23a19bdd

select
  d.id as document_id,
  d.file_name,
  d.processing_status,
  d.processing_error,
  d.updated_at as document_updated_at,
  da.updated_at as analysis_updated_at,
  length(coalesce(da.extracted_text, '')) as extracted_text_len,
  da.ocr_used,
  da.metadata_json ->> 'extractor_selected' as extractor_selected,
  da.metadata_json ->> 'extractor_status' as extractor_status,
  da.metadata_json ->> 'quality_reason' as quality_reason,
  da.metadata_json ->> 'last_completed_stage' as last_completed_stage,
  da.metadata_json ->> 'extraction_error' as extraction_error,
  da.metadata_json -> 'extraction_warnings' as extraction_warnings
from public.documents d
left join public.document_analysis da on da.document_id = d.id
where d.id = '4b6f1064-f06f-4f98-95b9-3b1b23a19bdd'::uuid;
