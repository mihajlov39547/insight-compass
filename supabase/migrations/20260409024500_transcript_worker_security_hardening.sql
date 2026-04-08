DO $$
BEGIN
  IF to_regprocedure('public.get_user_resources()') IS NOT NULL
     AND to_regprocedure('public.get_user_resources_v6_base()') IS NULL THEN
    EXECUTE 'ALTER FUNCTION public.get_user_resources() RENAME TO get_user_resources_v6_base';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_resources()
RETURNS TABLE(
  id uuid,
  resource_kind text,
  resource_type text,
  source_type text,
  provider text,
  title text,
  mime_type text,
  extension text,
  size_bytes bigint,
  storage_path text,
  owner_user_id uuid,
  owner_display_name text,
  container_type text,
  container_id uuid,
  container_name text,
  is_owned_by_me boolean,
  is_shared_with_me boolean,
  is_shared boolean,
  can_open boolean,
  can_view_details boolean,
  can_download boolean,
  can_rename boolean,
  can_delete boolean,
  can_retry boolean,
  uploaded_at timestamptz,
  updated_at timestamptz,
  processing_status text,
  processing_error text,
  summary text,
  page_count integer,
  word_count integer,
  detected_language text,
  link_url text,
  normalized_url text,
  preview_title text,
  preview_domain text,
  preview_favicon_url text,
  media_video_id text,
  media_channel_name text,
  media_thumbnail_url text,
  media_duration_seconds integer,
  transcript_status text,
  transcript_error text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    g.id,
    g.resource_kind,
    g.resource_type,
    g.source_type,
    g.provider,
    g.title,
    g.mime_type,
    g.extension,
    g.size_bytes,
    g.storage_path,
    g.owner_user_id,
    g.owner_display_name,
    g.container_type,
    g.container_id,
    g.container_name,
    g.is_owned_by_me,
    g.is_shared_with_me,
    g.is_shared,
    g.can_open,
    g.can_view_details,
    g.can_download,
    g.can_rename,
    g.can_delete,
    CASE
      WHEN g.provider = 'youtube'
        AND g.source_type = 'linked'
        AND g.transcript_status = 'failed'
      THEN true
      ELSE g.can_retry
    END AS can_retry,
    g.uploaded_at,
    g.updated_at,
    g.processing_status,
    g.processing_error,
    g.summary,
    g.page_count,
    g.word_count,
    g.detected_language,
    g.link_url,
    g.normalized_url,
    g.preview_title,
    g.preview_domain,
    g.preview_favicon_url,
    g.media_video_id,
    g.media_channel_name,
    g.media_thumbnail_url,
    g.media_duration_seconds,
    g.transcript_status,
    g.transcript_error
  FROM public.get_user_resources_v6_base() g;
$$;

REVOKE ALL ON FUNCTION public.get_user_resources() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_resources() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_next_youtube_transcript_job(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE(
  job_id uuid,
  resource_id uuid,
  video_id text,
  normalized_url text,
  attempt_count integer,
  max_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only service role can claim transcript jobs';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT j.id, j.resource_link_id
    FROM public.youtube_transcript_jobs j
    WHERE j.status = 'queued'
    ORDER BY j.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.youtube_transcript_jobs j
    SET
      status = 'running',
      attempt_count = j.attempt_count + 1,
      worker_id = p_worker_id,
      started_at = COALESCE(j.started_at, now()),
      lease_expires_at = now() + make_interval(secs => GREATEST(COALESCE(p_lease_seconds, 120), 30))
    FROM candidate c
    WHERE j.id = c.id
    RETURNING j.*
  ),
  link_running AS (
    UPDATE public.resource_links rl
    SET
      transcript_status = 'running',
      transcript_error = NULL,
      metadata = COALESCE(rl.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'transcript', jsonb_build_object(
            'status', 'running',
            'stub', false,
            'started_at', now()
          )
        )
    FROM claimed c
    WHERE rl.id = c.resource_link_id
    RETURNING rl.id
  )
  SELECT
    c.id AS job_id,
    rl.id AS resource_id,
    COALESCE(NULLIF(rl.media_video_id, ''), public.extract_youtube_video_id(COALESCE(rl.normalized_url, rl.url))) AS video_id,
    COALESCE(rl.normalized_url, public.normalize_resource_url(rl.url)) AS normalized_url,
    c.attempt_count,
    c.max_attempts
  FROM claimed c
  JOIN public.resource_links rl ON rl.id = c.resource_link_id;
END;
$$;

DROP FUNCTION IF EXISTS public.complete_youtube_transcript_job(uuid, boolean, text, text);

CREATE OR REPLACE FUNCTION public.complete_youtube_transcript_job(
  p_job_id uuid,
  p_success boolean,
  p_transcript_text text DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_worker_id text DEFAULT NULL
)
RETURNS TABLE(
  job_id uuid,
  resource_id uuid,
  transcript_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_job public.youtube_transcript_jobs%ROWTYPE;
  v_error text;
  v_is_service_role boolean := auth.role() = 'service_role';
BEGIN
  IF NOT v_is_service_role THEN
    RAISE EXCEPTION 'Only service role can complete transcript jobs';
  END IF;

  SELECT * INTO v_job
  FROM public.youtube_transcript_jobs j
  WHERE j.id = p_job_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transcript job not found';
  END IF;

  IF v_job.status <> 'running' THEN
    RAISE EXCEPTION 'Transcript job is not running';
  END IF;

  IF v_job.lease_expires_at IS NOT NULL AND v_job.lease_expires_at < now() THEN
    UPDATE public.youtube_transcript_jobs j
    SET
      status = 'failed',
      error_message = 'Lease expired before completion',
      finished_at = now(),
      lease_expires_at = NULL
    WHERE j.id = v_job.id;

    UPDATE public.resource_links rl
    SET
      transcript_status = 'failed',
      transcript_error = 'Lease expired before completion',
      transcript_updated_at = now()
    WHERE rl.id = v_job.resource_link_id;

    RAISE EXCEPTION 'Transcript job lease expired';
  END IF;

  IF p_worker_id IS NOT NULL
     AND v_job.worker_id IS NOT NULL
     AND p_worker_id <> v_job.worker_id THEN
    RAISE EXCEPTION 'Worker mismatch: job claimed by %, completed by %', v_job.worker_id, p_worker_id;
  END IF;

  IF p_success THEN
    UPDATE public.youtube_transcript_jobs j
    SET
      status = 'completed',
      transcript_text = p_transcript_text,
      error_message = NULL,
      finished_at = now(),
      lease_expires_at = NULL
    WHERE j.id = v_job.id;

    UPDATE public.resource_links rl
    SET
      transcript_status = 'ready',
      transcript_error = NULL,
      transcript_updated_at = now(),
      status = 'transcript_ready',
      metadata = COALESCE(rl.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'transcript', jsonb_build_object(
            'status', 'ready',
            'ingested_at', now(),
            'length', char_length(COALESCE(p_transcript_text, '')),
            'stub', false
          ),
          'enrichment', jsonb_build_object(
            'stage', 'transcript_ready',
            'lifecycle', jsonb_build_array('linked', 'metadata_ready', 'queued', 'running', 'transcript_ready')
          )
        )
    WHERE rl.id = v_job.resource_link_id;

    RETURN QUERY SELECT v_job.id, v_job.resource_link_id, 'ready'::text;
    RETURN;
  END IF;

  v_error := COALESCE(NULLIF(btrim(p_error), ''), 'Transcript ingestion failed');

  UPDATE public.youtube_transcript_jobs j
  SET
    status = 'failed',
    error_message = v_error,
    finished_at = now(),
    lease_expires_at = NULL
  WHERE j.id = v_job.id;

  UPDATE public.resource_links rl
  SET
    transcript_status = 'failed',
    transcript_error = v_error,
    transcript_updated_at = now(),
    status = 'metadata_ready',
    metadata = COALESCE(rl.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'transcript', jsonb_build_object(
          'status', 'failed',
          'error', v_error,
          'failed_at', now(),
          'stub', false
        ),
        'enrichment', jsonb_build_object(
          'stage', 'metadata_ready',
          'lifecycle', jsonb_build_array('linked', 'metadata_ready', 'queued', 'running', 'failed')
        )
      )
  WHERE rl.id = v_job.resource_link_id;

  RETURN QUERY SELECT v_job.id, v_job.resource_link_id, 'failed'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_youtube_transcript_job(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_next_youtube_transcript_job(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_youtube_transcript_job(text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.complete_youtube_transcript_job(uuid, boolean, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_youtube_transcript_job(uuid, boolean, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_youtube_transcript_job(uuid, boolean, text, text, text) TO service_role;
