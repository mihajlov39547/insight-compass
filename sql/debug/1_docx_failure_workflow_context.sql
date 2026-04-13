-- 1_ latest workflow run + key context fields
-- DOC ID prefilled: 4b6f1064-f06f-4f98-95b9-3b1b23a19bdd

with latest_wr as (
  select wr.*
  from public.workflow_runs wr
  where wr.trigger_entity_type = 'document'
    and wr.trigger_entity_id = '4b6f1064-f06f-4f98-95b9-3b1b23a19bdd'::uuid
  order by wr.created_at desc
  limit 1
)
select
  id as workflow_run_id,
  status as workflow_status,
  failure_reason,
  started_at,
  completed_at,
  updated_at,
  context ->> 'docx_extraction_method' as docx_extraction_method,
  context ->> 'docx_extraction_error' as docx_extraction_error,
  context ->> 'docx_extracted_text_length' as docx_extracted_text_length,
  context ->> 'extractor_status' as extractor_status
from latest_wr;
