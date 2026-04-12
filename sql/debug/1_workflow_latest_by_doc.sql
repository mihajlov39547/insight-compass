-- 1_ latest workflow run for this document
-- Replace <DOC_ID> before running.

with latest_wr as (
  select wr.*
  from public.workflow_runs wr
  where wr.trigger_entity_type = 'document'
    and wr.trigger_entity_id = '9640310f-42d8-4dd3-9b88-26af7ab2f1aa'::uuid
  order by wr.created_at desc
  limit 1
)
select
  id as workflow_run_id,
  status as workflow_status,
  started_at,
  completed_at,
  updated_at,
  failure_reason,
  context
from latest_wr;
