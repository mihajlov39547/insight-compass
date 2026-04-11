-- 5_ Stale lease diagnostics for claimed/running activities (latest workflow run)
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
  ar.status,
  ar.claimed_by,
  ar.claimed_at,
  ar.started_at,
  ar.lease_expires_at,
  now() as now_utc,
  (ar.lease_expires_at is not null and ar.lease_expires_at <= now()) as lease_expired_now,
  extract(epoch from (now() - coalesce(ar.started_at, ar.claimed_at, ar.updated_at)))::bigint as age_seconds,
  ar.attempt_count,
  ar.max_attempts,
  ar.next_retry_at,
  ar.error_message
from public.activity_runs ar
join latest_wr l on l.id = ar.workflow_run_id
where ar.status in ('claimed', 'running', 'waiting_retry')
order by ar.updated_at desc;
