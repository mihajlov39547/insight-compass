-- 3_ DOCX extraction activity output details (most important)
-- DOC ID prefilled: 4b6f1064-f06f-4f98-95b9-3b1b23a19bdd

with latest_wr as (
  select wr.id
  from public.workflow_runs wr
  where wr.trigger_entity_type = 'document'
    and wr.trigger_entity_id = '4b6f1064-f06f-4f98-95b9-3b1b23a19bdd'::uuid
  order by wr.created_at desc
  limit 1
),
docx_activity as (
  select ar.*
  from public.activity_runs ar
  join latest_wr l on l.id = ar.workflow_run_id
  where ar.activity_key = 'document.extract_docx_text'
  order by ar.created_at desc
  limit 1
)
select
  id as activity_run_id,
  status,
  started_at,
  finished_at,
  output_payload ->> 'method' as method,
  output_payload ->> 'extraction_status' as extraction_status,
  output_payload ->> 'extracted_text_length' as extracted_text_length,
  output_payload ->> 'quality_reason' as quality_reason,
  output_payload ->> 'extraction_error' as extraction_error,
  output_payload
from docx_activity;
