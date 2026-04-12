-- 2_ activity states in that workflow (focus: extract_docx_text)
-- Replace <DOC_ID> before running.

with latest_wr as (
  select wr.id
  from public.workflow_runs wr
  where wr.trigger_entity_type = 'document'
    and wr.trigger_entity_id = '9640310f-42d8-4dd3-9b88-26af7ab2f1aa'::uuid
  order by wr.created_at desc
  limit 1
)
select
  ar.id as activity_run_id,
  ar.activity_key,
  ar.handler_key,
  ar.status,
  ar.attempt_count,
  ar.max_attempts,
  ar.started_at,
  ar.finished_at,
  ar.lease_expires_at,
  ar.next_retry_at,
  ar.error_message,
  ar.error_details,
  ar.updated_at
from public.activity_runs ar
join latest_wr l on l.id = ar.workflow_run_id
order by ar.created_at asc;
