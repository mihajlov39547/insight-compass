-- 4_ event trail around DOCX extraction and workflow termination
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
  we.created_at,
  we.event_type,
  we.actor,
  we.activity_run_id,
  we.details
from public.workflow_events we
join latest_wr l on l.id = we.workflow_run_id
where we.event_type::text in (
  'activity_claimed',
  'activity_started',
  'activity_completed',
  'activity_failed',
  'activity_retrying',
  'workflow_failed',
  'workflow_completed',
  'workflow_context_patched'
)
order by we.created_at desc
limit 200;
