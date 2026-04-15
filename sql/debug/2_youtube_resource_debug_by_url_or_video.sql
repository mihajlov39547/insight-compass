-- 6_ YouTube resource transcript debug by URL or video ID
-- Adjust filters in WHERE clause as needed.

select
  rl.id as resource_id,
  rl.created_at,
  rl.updated_at,
  rl.provider,
  rl.media_video_id,
  rl.url,
  rl.normalized_url,
  rl.transcript_status,
  rl.transcript_error,
  rl.metadata #>> '{transcript,provider}' as transcript_provider,
  rl.metadata #>> '{transcript,winning_strategy}' as transcript_winning_strategy,
  (rl.metadata #> '{transcript,debug}') is not null as has_debug,
  rl.metadata #>> '{transcript,debug,totalDurationMs}' as debug_total_duration_ms,
  rl.metadata #>> '{transcript,debug,winningStrategy}' as debug_winning_strategy,
  jsonb_pretty(rl.metadata #> '{transcript,debug}') as transcript_debug_json_pretty
from public.resource_links rl
where rl.provider = 'youtube'
  and (
    rl.media_video_id = 'bjdBVZa66oU'
    or rl.url ilike '%bjdBVZa66oU%'
    or coalesce(rl.normalized_url, '') ilike '%bjdBVZa66oU%'
  )
order by rl.updated_at desc
limit 50;