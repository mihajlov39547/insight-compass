-- Environment requirement for scheduled worker invocation:
--   ALTER DATABASE postgres SET app.settings.supabase_url = 'https://<project-ref>.supabase.co';
--   ALTER DATABASE postgres SET app.settings.youtube_transcript_worker_secret = '<strong-random-secret>';

CREATE TABLE IF NOT EXISTS public.link_transcript_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_link_id uuid NOT NULL REFERENCES public.resource_links(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  project_id uuid NULL REFERENCES public.projects(id) ON DELETE SET NULL,
  notebook_id uuid NULL REFERENCES public.notebooks(id) ON DELETE SET NULL,
  chunk_index integer NOT NULL,
  chunk_text text NOT NULL,
  embedding extensions.vector(1536) NULL,
  token_count integer NOT NULL DEFAULT 0,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(chunk_text, ''))) STORED,
  UNIQUE(resource_link_id, chunk_index)
);

ALTER TABLE public.link_transcript_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view accessible transcript chunks" ON public.link_transcript_chunks;
CREATE POLICY "Users can view accessible transcript chunks"
ON public.link_transcript_chunks FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR (project_id IS NOT NULL AND public.check_item_permission(auth.uid(), project_id, 'project', 'viewer'))
  OR (notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'viewer'))
);

DROP TRIGGER IF EXISTS update_link_transcript_chunks_updated_at ON public.link_transcript_chunks;
CREATE TRIGGER update_link_transcript_chunks_updated_at
  BEFORE UPDATE ON public.link_transcript_chunks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_link_transcript_chunks_resource_idx
  ON public.link_transcript_chunks(resource_link_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_link_transcript_chunks_search_vector
  ON public.link_transcript_chunks USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS idx_link_transcript_chunks_embedding
  ON public.link_transcript_chunks USING ivfflat (embedding extensions.vector_cosine_ops)
  WITH (lists = 100);

DROP FUNCTION IF EXISTS public.search_link_transcript_chunks(extensions.vector, integer, double precision, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.search_link_transcript_chunks(
  query_embedding extensions.vector,
  match_count integer DEFAULT 10,
  similarity_threshold double precision DEFAULT 0.0,
  filter_project_id uuid DEFAULT NULL::uuid,
  filter_notebook_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  chunk_id uuid,
  resource_id uuid,
  project_id uuid,
  notebook_id uuid,
  chunk_index integer,
  chunk_text text,
  similarity double precision,
  resource_title text,
  normalized_url text,
  media_video_id text,
  transcript_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    ltc.id AS chunk_id,
    ltc.resource_link_id AS resource_id,
    ltc.project_id,
    ltc.notebook_id,
    ltc.chunk_index,
    ltc.chunk_text,
    (1 - (ltc.embedding <=> query_embedding))::float AS similarity,
    rl.title AS resource_title,
    rl.normalized_url,
    rl.media_video_id,
    rl.transcript_status
  FROM public.link_transcript_chunks ltc
  JOIN public.resource_links rl ON rl.id = ltc.resource_link_id
  WHERE
    (
      ltc.user_id = auth.uid()
      OR (ltc.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), ltc.project_id, 'project', 'viewer'))
      OR (ltc.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), ltc.notebook_id, 'notebook', 'viewer'))
    )
    AND ltc.embedding IS NOT NULL
    AND rl.transcript_status = 'ready'
    AND (filter_project_id IS NULL OR ltc.project_id = filter_project_id)
    AND (filter_notebook_id IS NULL OR ltc.notebook_id = filter_notebook_id)
    AND (1 - (ltc.embedding <=> query_embedding))::float >= similarity_threshold
  ORDER BY ltc.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.search_link_transcript_chunks(extensions.vector, integer, double precision, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_link_transcript_chunks(extensions.vector, integer, double precision, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_link_transcript_preview(
  p_resource_id uuid,
  p_limit integer DEFAULT 40,
  p_query text DEFAULT NULL
)
RETURNS TABLE(
  chunk_index integer,
  chunk_text text,
  token_count integer,
  match_rank real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    ltc.chunk_index,
    ltc.chunk_text,
    ltc.token_count,
    CASE
      WHEN p_query IS NULL OR btrim(p_query) = '' THEN NULL::real
      ELSE ts_rank(ltc.search_vector, plainto_tsquery('simple', p_query))
    END AS match_rank
  FROM public.link_transcript_chunks ltc
  JOIN public.resource_links rl ON rl.id = ltc.resource_link_id
  WHERE
    ltc.resource_link_id = p_resource_id
    AND (
      ltc.user_id = auth.uid()
      OR (ltc.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), ltc.project_id, 'project', 'viewer'))
      OR (ltc.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), ltc.notebook_id, 'notebook', 'viewer'))
    )
    AND (
      p_query IS NULL
      OR btrim(p_query) = ''
      OR ltc.search_vector @@ plainto_tsquery('simple', p_query)
    )
  ORDER BY
    CASE
      WHEN p_query IS NULL OR btrim(p_query) = '' THEN ltc.chunk_index::numeric
      ELSE ts_rank(ltc.search_vector, plainto_tsquery('simple', p_query))
    END DESC,
    ltc.chunk_index ASC
  LIMIT GREATEST(COALESCE(p_limit, 40), 1);
$$;

REVOKE ALL ON FUNCTION public.get_link_transcript_preview(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_link_transcript_preview(uuid, integer, text) TO authenticated;

DROP FUNCTION IF EXISTS public.complete_youtube_transcript_job(uuid, boolean, text, text, text);

CREATE OR REPLACE FUNCTION public.complete_youtube_transcript_job(
  p_job_id uuid,
  p_success boolean,
  p_transcript_text text DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_worker_id text DEFAULT NULL,
  p_chunk_count integer DEFAULT NULL
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
            'chunk_count', p_chunk_count,
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

REVOKE ALL ON FUNCTION public.complete_youtube_transcript_job(uuid, boolean, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_youtube_transcript_job(uuid, boolean, text, text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_youtube_transcript_job(uuid, boolean, text, text, text, integer) TO service_role;

DO $$
DECLARE
  v_job_exists boolean := false;
  v_supabase_url text := current_setting('app.settings.supabase_url', true);
  v_worker_secret text := current_setting('app.settings.youtube_transcript_worker_secret', true);
  v_headers jsonb;
BEGIN
  IF v_supabase_url IS NULL OR btrim(v_supabase_url) = '' THEN
    RAISE NOTICE 'app.settings.supabase_url is not set; transcript worker schedule not installed';
    RETURN;
  END IF;

  IF v_worker_secret IS NULL OR btrim(v_worker_secret) = '' THEN
    RAISE NOTICE 'app.settings.youtube_transcript_worker_secret is not set; transcript worker schedule not installed';
    RETURN;
  END IF;

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-worker-secret', v_worker_secret
  );

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'cron') THEN
    EXECUTE $check$
      SELECT EXISTS(
        SELECT 1 FROM cron.job WHERE jobname = 'youtube-transcript-worker-minute'
      )
    $check$ INTO v_job_exists;

    IF NOT v_job_exists THEN
      EXECUTE format(
        $schedule$
          SELECT cron.schedule(
            'youtube-transcript-worker-minute',
            '* * * * *',
            $cron$
              SELECT net.http_post(
                url := %L,
                headers := %L::jsonb,
                body := '{"max_jobs":10}'::jsonb
              );
            $cron$
          )
        $schedule$,
        v_supabase_url || '/functions/v1/youtube-transcript-worker',
        v_headers::text
      );
    END IF;
  ELSE
    RAISE NOTICE 'pg_cron and/or pg_net extension unavailable; transcript worker schedule not installed';
  END IF;
END;
$$;
