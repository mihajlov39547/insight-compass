-- 9_ Failed YouTube resources where debug payload is missing
-- Use this to isolate why UI shows: "No debug diagnostics available"

with failed_youtube as (
  select
    rl.id,
    rl.user_id,
    rl.created_at,
    rl.updated_at,
    rl.url,
    rl.normalized_url,
    rl.media_video_id,
    rl.transcript_status,
    rl.transcript_error,
    rl.metadata
  from public.resource_links rl
  where rl.provider = 'youtube'
    and rl.transcript_status = 'failed'
),
latest_job as (
  select distinct on (j.resource_link_id)
    j.resource_link_id,
    j.id as latest_job_id,
    j.status as latest_job_status,
    j.error_message,
    j.worker_id,
    j.created_at,
    j.started_at,
    j.finished_at,
    j.updated_at as job_updated_at
  from public.youtube_transcript_jobs j
  order by j.resource_link_id, j.created_at desc
)
select
  fy.id as resource_id,
  fy.updated_at as resource_updated_at,
  fy.media_video_id,
  fy.url,
  fy.transcript_error,
  fy.metadata #>> '{transcript,provider}' as transcript_provider,
  fy.metadata #>> '{transcript,winning_strategy}' as transcript_winning_strategy,
  (fy.metadata #> '{transcript,debug}') is not null as has_debug,
  lj.latest_job_id,
  lj.latest_job_status,
  lj.error_message as latest_job_error_message,
  lj.worker_id as latest_job_worker,
  lj.created_at as latest_job_created_at,
  lj.started_at as latest_job_started_at,
  lj.finished_at as latest_job_finished_at,
  lj.job_updated_at
from failed_youtube fy
left join latest_job lj on lj.resource_link_id = fy.id
where (fy.metadata #> '{transcript,debug}') is null
order by fy.updated_at desc
limit 200;