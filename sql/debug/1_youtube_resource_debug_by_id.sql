-- 6_ YouTube resource transcript debug by resource ID
-- Prefilled from your example resource:
-- b95141d3-dc38-4cd8-93ea-e26c26f74c1d

with target as (
  select
    rl.id,
    rl.url,
    rl.normalized_url,
    rl.provider,
    rl.media_video_id,
    rl.transcript_status,
    rl.transcript_error,
    rl.status,
    rl.updated_at,
    rl.metadata
  from public.resource_links rl
  where rl.id = 'b95141d3-dc38-4cd8-93ea-e26c26f74c1d'::uuid
),
stage_rollup as (
  select
    t.id,
    string_agg(
      concat(coalesce(s.elem ->> 'stage', '?'), ':', coalesce(s.elem ->> 'status', '?')),
      ' -> '
      order by s.ord
    ) as stage_status_chain
  from target t
  left join lateral jsonb_array_elements(
    coalesce(t.metadata #> '{transcript,debug,stages}', '[]'::jsonb)
  ) with ordinality as s(elem, ord)
    on true
  group by t.id
)
select
  t.id as resource_id,
  t.provider,
  t.media_video_id,
  t.url,
  t.normalized_url,
  t.status as resource_status,
  t.transcript_status,
  t.transcript_error,
  t.updated_at,
  t.metadata #>> '{transcript,provider}' as transcript_provider,
  t.metadata #>> '{transcript,winning_strategy}' as transcript_winning_strategy,
  t.metadata #>> '{transcript,error}' as transcript_debug_error,
  t.metadata #>> '{transcript,debug,totalDurationMs}' as debug_total_duration_ms,
  t.metadata #>> '{transcript,debug,serpapiSearchId}' as debug_serpapi_search_id,
  t.metadata #>> '{transcript,debug,pageExtractedInnertubeKey}' as debug_page_extracted_innertube_key,
  sr.stage_status_chain,
  jsonb_pretty(t.metadata #> '{transcript,debug}') as transcript_debug_json_pretty
from target t
left join stage_rollup sr on sr.id = t.id;