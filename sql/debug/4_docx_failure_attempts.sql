-- 4_ attempts for DOCX extraction activity (timing + hidden errors)
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
  select ar.id
  from public.activity_runs ar
  join latest_wr l on l.id = ar.workflow_run_id
  where ar.activity_key = 'document.extract_docx_text'
  order by ar.created_at desc
  limit 1
)
select
  aa.id as activity_attempt_id,
  aa.attempt_number,
  aa.claimed_by,
  aa.claimed_at,
  aa.started_at,
  aa.finished_at,
  aa.duration_ms,
  aa.error_message,
  aa.error_details,
  aa.output_payload
from public.activity_attempts aa
join docx_activity da on da.id = aa.activity_run_id
order by aa.attempt_number desc;
