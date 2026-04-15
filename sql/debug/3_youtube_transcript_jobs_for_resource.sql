-- 7_ Transcript job timeline for one YouTube resource
-- Prefilled from your example resource:
-- b95141d3-dc38-4cd8-93ea-e26c26f74c1d

select
  j.id as job_id,
  j.resource_link_id,
  j.status,
  j.attempt_count,
  j.max_attempts,
  j.worker_id,
  j.error_message,
  length(coalesce(j.transcript_text, '')) as transcript_text_len,
  j.created_at,
  j.started_at,
  j.finished_at,
  j.lease_expires_at,
  j.updated_at
from public.youtube_transcript_jobs j
where j.resource_link_id = 'b95141d3-dc38-4cd8-93ea-e26c26f74c1d'::uuid
order by j.created_at desc;