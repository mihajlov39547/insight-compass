-- 2_ all activity runs for the latest workflow (see exactly what failed)
-- DOC ID prefilled: 4b6f1064-f06f-4f98-95b9-3b1b23a19bdd

with latest_wr as (
  select wr.id
  from public.workflow_runs wr
  where wr.trigger_entity_type = 'document'
    and wr.trigger_entity_id = '4b6f1064-f06f-4f98-95b9-3b1b23a19bdd'::uuid
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
  ar.error_message,
  ar.error_details,
  ar.output_payload
from public.activity_runs ar
join latest_wr l on l.id = ar.workflow_run_id
order by ar.created_at asc;
