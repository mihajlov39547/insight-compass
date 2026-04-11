-- 4_ Workflow event log around DOCX extraction (latest workflow run)
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
  we.created_at,
  we.event_type,
  we.actor,
  we.activity_run_id,
  we.details
from public.workflow_events we
join latest_wr l on l.id = we.workflow_run_id
where
  we.event_type in (
    'activity_claimed',
    'activity_started',
    'activity_completed',
    'activity_failed',
    'activity_retrying',
    'workflow_failed',
    'workflow_completed'
  )
order by we.created_at desc
limit 200;
