-- 2_ Activity timeline for latest workflow run of this document
-- Replace <DOC_ID> before running.

with latest_wr as (
  select wr.id
  from public.workflow_runs wr
  where wr.trigger_entity_type = 'document'
    and wr.trigger_entity_id = '846fdf74-6e18-458c-b150-10bf804ebfb4'::uuid
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
  ar.claimed_by,
  ar.claimed_at,
  ar.started_at,
  ar.finished_at,
  ar.lease_expires_at,
  ar.next_retry_at,
  ar.error_message,
  ar.updated_at
from public.activity_runs ar
join latest_wr l on l.id = ar.workflow_run_id
order by ar.created_at asc;
