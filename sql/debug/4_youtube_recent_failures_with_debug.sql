-- 8_ Recent failed YouTube resources + debug presence summary

with yt as (
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
    j.error_message as latest_job_error,
    j.worker_id as latest_job_worker,
    j.created_at as latest_job_created_at,
    j.finished_at as latest_job_finished_at
  from public.youtube_transcript_jobs j
  order by j.resource_link_id, j.created_at desc
)
select
  yt.id as resource_id,
  yt.updated_at,
  yt.media_video_id,
  yt.url,
  yt.transcript_error,
  (yt.metadata #> '{transcript,debug}') is not null as has_debug,
  yt.metadata #>> '{transcript,winning_strategy}' as transcript_winning_strategy,
  yt.metadata #>> '{transcript,provider}' as transcript_provider,
  yt.metadata #>> '{transcript,debug,winningStrategy}' as debug_winning_strategy,
  yt.metadata #>> '{transcript,debug,totalDurationMs}' as debug_total_duration_ms,
  lj.latest_job_id,
  lj.latest_job_status,
  lj.latest_job_error,
  lj.latest_job_worker,
  lj.latest_job_created_at,
  lj.latest_job_finished_at
from yt
left join latest_job lj on lj.resource_link_id = yt.id
order by yt.updated_at desc
limit 100;