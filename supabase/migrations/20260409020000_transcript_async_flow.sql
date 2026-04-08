ALTER TABLE public.resource_links
  ADD COLUMN IF NOT EXISTS transcript_error text,
  ADD COLUMN IF NOT EXISTS transcript_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.youtube_transcript_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_link_id uuid NOT NULL REFERENCES public.resource_links(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  requested_by uuid NOT NULL,
  transcript_text text NULL,
  error_message text NULL,
  worker_id text NULL,
  lease_expires_at timestamptz NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.youtube_transcript_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own transcript jobs" ON public.youtube_transcript_jobs;
CREATE POLICY "Users can view own transcript jobs"
ON public.youtube_transcript_jobs FOR SELECT TO authenticated
USING (requested_by = auth.uid());

DROP POLICY IF EXISTS "Users can create own transcript jobs" ON public.youtube_transcript_jobs;
CREATE POLICY "Users can create own transcript jobs"
ON public.youtube_transcript_jobs FOR INSERT TO authenticated
WITH CHECK (requested_by = auth.uid());

DROP TRIGGER IF EXISTS update_youtube_transcript_jobs_updated_at ON public.youtube_transcript_jobs;
CREATE TRIGGER update_youtube_transcript_jobs_updated_at
  BEFORE UPDATE ON public.youtube_transcript_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_youtube_transcript_jobs_status_created_at
  ON public.youtube_transcript_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_youtube_transcript_jobs_resource_link_id
  ON public.youtube_transcript_jobs(resource_link_id);

CREATE OR REPLACE FUNCTION public.enqueue_youtube_transcript_job(
  p_resource_id uuid,
  p_force_retry boolean DEFAULT false
)
RETURNS TABLE(
  job_id uuid,
  transcript_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_link public.resource_links%ROWTYPE;
  v_existing_job_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_link
  FROM public.resource_links rl
  WHERE rl.id = p_resource_id
    AND (
      auth.uid() = rl.user_id
      OR (rl.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.project_id, 'project', 'editor'))
      OR (rl.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.notebook_id, 'notebook', 'editor'))
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resource link not found or permission denied';
  END IF;

  IF COALESCE(v_link.provider, 'unknown') <> 'youtube' THEN
    RAISE EXCEPTION 'Transcript ingestion is currently available only for YouTube links';
  END IF;

  IF v_link.transcript_status = 'ready' AND NOT p_force_retry THEN
    RETURN QUERY SELECT NULL::uuid, 'ready'::text;
    RETURN;
  END IF;

  SELECT j.id INTO v_existing_job_id
  FROM public.youtube_transcript_jobs j
  WHERE j.resource_link_id = v_link.id
    AND j.status IN ('queued', 'running')
  ORDER BY j.created_at DESC
  LIMIT 1;

  IF v_existing_job_id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_job_id, 'queued'::text;
    RETURN;
  END IF;

  INSERT INTO public.youtube_transcript_jobs (
    resource_link_id,
    status,
    requested_by,
    max_attempts
  )
  VALUES (
    v_link.id,
    'queued',
    auth.uid(),
    3
  )
  RETURNING id INTO v_existing_job_id;

  UPDATE public.resource_links rl
  SET
    transcript_status = 'queued',
    transcript_error = NULL,
    status = 'metadata_ready',
    metadata = COALESCE(rl.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'transcript', jsonb_build_object(
          'status', 'queued',
          'stub', false
        ),
        'enrichment', jsonb_build_object(
          'stage', 'metadata_ready',
          'lifecycle', jsonb_build_array('linked', 'metadata_ready', 'queued')
        )
      )
  WHERE rl.id = v_link.id;

  RETURN QUERY SELECT v_existing_job_id, 'queued'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_youtube_transcript_job(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_youtube_transcript_job(uuid, boolean) TO authenticated;

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

REVOKE ALL ON FUNCTION public.claim_next_youtube_transcript_job(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_youtube_transcript_job(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_youtube_transcript_job(
  p_job_id uuid,
  p_success boolean,
  p_transcript_text text DEFAULT NULL,
  p_error text DEFAULT NULL
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
BEGIN
  SELECT * INTO v_job
  FROM public.youtube_transcript_jobs j
  WHERE j.id = p_job_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transcript job not found';
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

REVOKE ALL ON FUNCTION public.complete_youtube_transcript_job(uuid, boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_youtube_transcript_job(uuid, boolean, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.run_link_adapter_enrichment(p_resource_id uuid)
RETURNS TABLE(
  id uuid,
  provider text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_link public.resource_links%ROWTYPE;
  v_normalized_url text;
  v_domain text;
  v_provider text;
  v_preview_title text;
  v_favicon text;
  v_video_id text;
  v_thumbnail text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_link
  FROM public.resource_links rl
  WHERE rl.id = p_resource_id
    AND (
      auth.uid() = rl.user_id
      OR (rl.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.project_id, 'project', 'editor'))
      OR (rl.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.notebook_id, 'notebook', 'editor'))
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resource link not found or permission denied';
  END IF;

  v_normalized_url := public.normalize_resource_url(v_link.url);
  v_domain := public.extract_url_domain(v_normalized_url);
  v_favicon := CASE WHEN v_domain IS NULL THEN NULL ELSE 'https://' || v_domain || '/favicon.ico' END;

  v_provider := COALESCE(NULLIF(btrim(v_link.provider), ''), 'unknown');
  IF v_provider = 'unknown' THEN
    v_provider := public.detect_source_provider_from_url(v_normalized_url);
  END IF;

  v_preview_title := COALESCE(NULLIF(btrim(v_link.preview_title), ''), NULLIF(btrim(v_link.title), ''), v_domain, v_normalized_url);

  UPDATE public.resource_links rl
  SET
    normalized_url = v_normalized_url,
    preview_domain = COALESCE(v_link.preview_domain, v_domain),
    preview_favicon_url = COALESCE(v_link.preview_favicon_url, v_favicon),
    preview_title = v_preview_title,
    provider = v_provider,
    source_type = 'linked',
    status = 'metadata_ready',
    adapter_key = 'generic_link',
    metadata = COALESCE(rl.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'enrichment', jsonb_build_object(
          'stage', 'metadata_ready',
          'normalized_url', v_normalized_url,
          'domain', v_domain,
          'provider', v_provider,
          'lifecycle', jsonb_build_array('linked', 'metadata_ready')
        )
      )
  WHERE rl.id = v_link.id;

  IF v_provider = 'youtube' THEN
    v_video_id := public.extract_youtube_video_id(v_normalized_url);
    v_thumbnail := CASE
      WHEN v_video_id IS NULL THEN NULL
      ELSE 'https://i.ytimg.com/vi/' || v_video_id || '/hqdefault.jpg'
    END;

    UPDATE public.resource_links rl
    SET
      adapter_key = 'youtube',
      resource_type = 'video',
      media_video_id = v_video_id,
      media_channel_name = COALESCE(media_channel_name, 'YouTube'),
      media_thumbnail_url = COALESCE(media_thumbnail_url, v_thumbnail),
      preview_favicon_url = COALESCE(preview_favicon_url, v_favicon),
      preview_title = CASE
        WHEN NULLIF(btrim(rl.preview_title), '') IS NULL
          OR NULLIF(btrim(rl.preview_title), '') = NULLIF(btrim(v_normalized_url), '')
          OR NULLIF(btrim(rl.preview_title), '') = NULLIF(btrim(rl.url), '')
        THEN COALESCE('YouTube video ' || v_video_id, rl.preview_title, rl.title)
        ELSE rl.preview_title
      END,
      transcript_status = 'queued',
      transcript_error = NULL,
      status = 'metadata_ready',
      metadata = COALESCE(rl.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'youtube', jsonb_build_object(
            'video_id', v_video_id,
            'thumbnail_url', v_thumbnail
          ),
          'transcript', jsonb_build_object(
            'status', 'queued',
            'stub', false
          ),
          'enrichment', jsonb_build_object(
            'stage', 'metadata_ready',
            'provider', 'youtube',
            'lifecycle', jsonb_build_array('linked', 'metadata_ready', 'queued')
          )
        )
    WHERE rl.id = v_link.id;
  END IF;

  RETURN QUERY
  SELECT rl.id, rl.provider, rl.status
  FROM public.resource_links rl
  WHERE rl.id = v_link.id;
END;
$$;

REVOKE ALL ON FUNCTION public.run_link_adapter_enrichment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_link_adapter_enrichment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_link_resource_stub(
  p_url text,
  p_title text DEFAULT NULL,
  p_provider text DEFAULT 'unknown',
  p_container_type text DEFAULT 'personal',
  p_container_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  title text,
  url text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_url text;
  v_title text;
  v_provider text;
  v_container_type text;
  v_project_id uuid := NULL;
  v_notebook_id uuid := NULL;
  v_inserted_id uuid;
  v_final_provider text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_url := btrim(p_url);
  v_title := btrim(COALESCE(p_title, ''));
  v_provider := COALESCE(NULLIF(btrim(p_provider), ''), 'unknown');
  v_container_type := COALESCE(NULLIF(btrim(p_container_type), ''), 'personal');

  IF v_url IS NULL OR v_url = '' THEN
    RAISE EXCEPTION 'URL is required';
  END IF;

  IF v_container_type NOT IN ('personal', 'project', 'notebook') THEN
    RAISE EXCEPTION 'Invalid container_type: %', v_container_type;
  END IF;

  IF v_container_type = 'project' THEN
    IF p_container_id IS NULL THEN
      RAISE EXCEPTION 'project container_id is required';
    END IF;

    IF NOT public.check_item_permission(auth.uid(), p_container_id, 'project', 'editor') THEN
      RAISE EXCEPTION 'Permission denied for target project';
    END IF;

    v_project_id := p_container_id;
  ELSIF v_container_type = 'notebook' THEN
    IF p_container_id IS NULL THEN
      RAISE EXCEPTION 'notebook container_id is required';
    END IF;

    IF NOT public.check_item_permission(auth.uid(), p_container_id, 'notebook', 'editor') THEN
      RAISE EXCEPTION 'Permission denied for target notebook';
    END IF;

    v_notebook_id := p_container_id;
  END IF;

  IF v_title IS NULL OR v_title = '' THEN
    v_title := public.normalize_resource_url(v_url);
  END IF;

  INSERT INTO public.resource_links (
    user_id,
    project_id,
    notebook_id,
    title,
    url,
    provider,
    source_type,
    resource_type,
    status,
    transcript_status,
    metadata
  )
  VALUES (
    auth.uid(),
    v_project_id,
    v_notebook_id,
    v_title,
    v_url,
    v_provider,
    'linked',
    'link',
    'linked',
    'none',
    jsonb_build_object('stub', true, 'url', v_url, 'lifecycle', jsonb_build_array('linked'))
  )
  RETURNING resource_links.id INTO v_inserted_id;

  PERFORM public.run_link_adapter_enrichment(v_inserted_id);

  SELECT rl.provider INTO v_final_provider
  FROM public.resource_links rl
  WHERE rl.id = v_inserted_id;

  IF v_final_provider = 'youtube' THEN
    PERFORM public.enqueue_youtube_transcript_job(v_inserted_id, false);
  END IF;

  RETURN QUERY
  SELECT rl.id, rl.title, rl.url, rl.created_at
  FROM public.resource_links rl
  WHERE rl.id = v_inserted_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_link_resource_stub(text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_link_resource_stub(text, text, text, text, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.get_user_resources();

CREATE FUNCTION public.get_user_resources()
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
  WITH doc_resources AS (
    SELECT
      d.id,
      'document'::text AS resource_kind,
      CASE
        WHEN d.file_type IN ('pdf', 'doc', 'docx', 'rtf') THEN 'document'
        WHEN d.file_type IN ('jpg', 'jpeg', 'png') THEN 'image'
        WHEN d.file_type IN ('xls', 'xlsx', 'csv') THEN 'spreadsheet'
        WHEN d.file_type IN ('pptx') THEN 'presentation'
        WHEN d.file_type IN ('eml', 'msg') THEN 'email'
        WHEN d.file_type IN ('txt', 'txtx', 'md', 'log') THEN 'text'
        WHEN d.file_type IN ('xml', 'json') THEN 'dataset'
        ELSE 'other'
      END AS resource_type,
      'uploaded'::text AS source_type,
      'local_upload'::text AS provider,
      d.file_name AS title,
      d.mime_type,
      d.file_type AS extension,
      d.file_size AS size_bytes,
      d.storage_path,
      d.user_id AS owner_user_id,
      COALESCE(p.full_name, p.username, p.email, 'Unknown') AS owner_display_name,
      CASE
        WHEN d.notebook_id IS NOT NULL THEN 'notebook'
        WHEN d.project_id IS NOT NULL THEN 'project'
        ELSE 'personal'
      END AS container_type,
      COALESCE(d.notebook_id, d.project_id) AS container_id,
      COALESCE(nb.name, pr.name) AS container_name,
      (d.user_id = auth.uid()) AS is_owned_by_me,
      (d.user_id <> auth.uid()) AS is_shared_with_me,
      (d.user_id <> auth.uid()) AS is_shared,
      true AS can_open,
      true AS can_view_details,
      (d.storage_path IS NOT NULL AND d.storage_path <> '') AS can_download,
      (
        auth.uid() = d.user_id
        OR (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'editor'))
        OR (d.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.notebook_id, 'notebook', 'editor'))
      ) AS can_rename,
      (
        auth.uid() = d.user_id
        OR (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'editor'))
        OR (d.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.notebook_id, 'notebook', 'editor'))
      ) AS can_delete,
      (
        auth.uid() = d.user_id
        OR (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'editor'))
        OR (d.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.notebook_id, 'notebook', 'editor'))
      ) AS can_retry,
      d.created_at AS uploaded_at,
      COALESCE(d.updated_at, d.created_at) AS updated_at,
      d.processing_status,
      d.processing_error,
      d.summary,
      d.page_count,
      d.word_count,
      d.detected_language,
      NULL::text AS link_url,
      NULL::text AS normalized_url,
      NULL::text AS preview_title,
      NULL::text AS preview_domain,
      NULL::text AS preview_favicon_url,
      NULL::text AS media_video_id,
      NULL::text AS media_channel_name,
      NULL::text AS media_thumbnail_url,
      NULL::integer AS media_duration_seconds,
      NULL::text AS transcript_status,
      NULL::text AS transcript_error
    FROM public.documents d
    LEFT JOIN public.profiles p ON p.user_id = d.user_id
    LEFT JOIN public.projects pr ON pr.id = d.project_id
    LEFT JOIN public.notebooks nb ON nb.id = d.notebook_id
    WHERE
      auth.uid() IS NOT NULL
      AND (
        d.user_id = auth.uid()
        OR (d.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.project_id, 'project', 'viewer'))
        OR (d.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), d.notebook_id, 'notebook', 'viewer'))
      )
  ),
  link_resources AS (
    SELECT
      rl.id,
      'resource'::text AS resource_kind,
      COALESCE(NULLIF(rl.resource_type, ''), 'link') AS resource_type,
      COALESCE(NULLIF(rl.source_type, ''), 'linked') AS source_type,
      COALESCE(NULLIF(rl.provider, ''), public.detect_source_provider_from_url(COALESCE(rl.normalized_url, rl.url))) AS provider,
      COALESCE(NULLIF(rl.preview_title, ''), rl.title) AS title,
      'text/uri-list'::text AS mime_type,
      'url'::text AS extension,
      0::bigint AS size_bytes,
      ''::text AS storage_path,
      rl.user_id AS owner_user_id,
      COALESCE(p.full_name, p.username, p.email, 'Unknown') AS owner_display_name,
      CASE
        WHEN rl.notebook_id IS NOT NULL THEN 'notebook'
        WHEN rl.project_id IS NOT NULL THEN 'project'
        ELSE 'personal'
      END AS container_type,
      COALESCE(rl.notebook_id, rl.project_id) AS container_id,
      COALESCE(nb.name, pr.name) AS container_name,
      (rl.user_id = auth.uid()) AS is_owned_by_me,
      (rl.user_id <> auth.uid()) AS is_shared_with_me,
      (rl.user_id <> auth.uid()) AS is_shared,
      (COALESCE(rl.notebook_id, rl.project_id) IS NOT NULL) AS can_open,
      true AS can_view_details,
      false AS can_download,
      (
        auth.uid() = rl.user_id
        OR (rl.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.project_id, 'project', 'editor'))
        OR (rl.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.notebook_id, 'notebook', 'editor'))
      ) AS can_rename,
      (
        auth.uid() = rl.user_id
        OR (rl.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.project_id, 'project', 'editor'))
        OR (rl.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.notebook_id, 'notebook', 'editor'))
      ) AS can_delete,
      false AS can_retry,
      rl.created_at AS uploaded_at,
      rl.updated_at,
      CASE
        WHEN rl.transcript_status IN ('queued', 'running') THEN rl.transcript_status
        WHEN rl.transcript_status = 'ready' THEN 'transcript_ready'
        WHEN rl.transcript_status = 'failed' THEN 'failed'
        ELSE COALESCE(NULLIF(rl.status, ''), 'linked')
      END AS processing_status,
      CASE
        WHEN rl.transcript_status = 'failed' THEN rl.transcript_error
        ELSE NULL
      END AS processing_error,
      COALESCE(rl.normalized_url, rl.url) AS summary,
      NULL::integer AS page_count,
      NULL::integer AS word_count,
      NULL::text AS detected_language,
      rl.url AS link_url,
      COALESCE(rl.normalized_url, public.normalize_resource_url(rl.url)) AS normalized_url,
      COALESCE(NULLIF(rl.preview_title, ''), rl.title) AS preview_title,
      COALESCE(NULLIF(rl.preview_domain, ''), public.extract_url_domain(COALESCE(rl.normalized_url, rl.url))) AS preview_domain,
      COALESCE(
        NULLIF(rl.preview_favicon_url, ''),
        CASE
          WHEN public.extract_url_domain(COALESCE(rl.normalized_url, rl.url)) IS NULL THEN NULL
          ELSE 'https://' || public.extract_url_domain(COALESCE(rl.normalized_url, rl.url)) || '/favicon.ico'
        END
      ) AS preview_favicon_url,
      rl.media_video_id,
      rl.media_channel_name,
      rl.media_thumbnail_url,
      rl.media_duration_seconds,
      rl.transcript_status,
      rl.transcript_error
    FROM public.resource_links rl
    LEFT JOIN public.profiles p ON p.user_id = rl.user_id
    LEFT JOIN public.projects pr ON pr.id = rl.project_id
    LEFT JOIN public.notebooks nb ON nb.id = rl.notebook_id
    WHERE
      auth.uid() IS NOT NULL
      AND (
        rl.user_id = auth.uid()
        OR (rl.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.project_id, 'project', 'viewer'))
        OR (rl.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), rl.notebook_id, 'notebook', 'viewer'))
      )
  )
  SELECT *
  FROM (
    SELECT * FROM doc_resources
    UNION ALL
    SELECT * FROM link_resources
  ) combined
  ORDER BY updated_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_user_resources() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_resources() TO authenticated;
