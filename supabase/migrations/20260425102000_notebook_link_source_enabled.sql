ALTER TABLE public.resource_links
ADD COLUMN IF NOT EXISTS notebook_enabled boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_resource_links_notebook_enabled
  ON public.resource_links(notebook_id, notebook_enabled)
  WHERE notebook_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.search_link_transcript_chunks(extensions.vector, integer, double precision, uuid, uuid);

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
    AND (filter_notebook_id IS NULL OR (ltc.notebook_id = filter_notebook_id AND rl.notebook_enabled = true))
    AND (1 - (ltc.embedding <=> query_embedding))::float >= similarity_threshold
  ORDER BY ltc.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.search_link_transcript_chunks(extensions.vector, integer, double precision, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_link_transcript_chunks(extensions.vector, integer, double precision, uuid, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.search_link_transcript_chunk_questions(extensions.vector, integer, double precision, uuid, uuid);

CREATE OR REPLACE FUNCTION public.search_link_transcript_chunk_questions(
  query_embedding extensions.vector,
  match_count integer DEFAULT 10,
  similarity_threshold double precision DEFAULT 0.0,
  filter_project_id uuid DEFAULT NULL::uuid,
  filter_notebook_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  question_id uuid,
  chunk_id uuid,
  resource_id uuid,
  project_id uuid,
  notebook_id uuid,
  chunk_index integer,
  chunk_text text,
  question_text text,
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
    q.id AS question_id,
    q.chunk_id,
    q.resource_link_id AS resource_id,
    q.project_id,
    q.notebook_id,
    c.chunk_index,
    c.chunk_text,
    q.question_text,
    (1 - (q.embedding <=> query_embedding))::float AS similarity,
    rl.title AS resource_title,
    rl.normalized_url,
    rl.media_video_id,
    rl.transcript_status
  FROM public.link_transcript_chunk_questions q
  JOIN public.link_transcript_chunks c ON c.id = q.chunk_id
  JOIN public.resource_links rl ON rl.id = q.resource_link_id
  WHERE
    (
      q.user_id = auth.uid()
      OR (q.project_id IS NOT NULL AND public.check_item_permission(auth.uid(), q.project_id, 'project', 'viewer'))
      OR (q.notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), q.notebook_id, 'notebook', 'viewer'))
    )
    AND q.embedding IS NOT NULL
    AND rl.transcript_status = 'ready'
    AND (filter_project_id IS NULL OR q.project_id = filter_project_id)
    AND (filter_notebook_id IS NULL OR (q.notebook_id = filter_notebook_id AND rl.notebook_enabled = true))
    AND (1 - (q.embedding <=> query_embedding))::float >= similarity_threshold
  ORDER BY q.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.search_link_transcript_chunk_questions(extensions.vector, integer, double precision, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_link_transcript_chunk_questions(extensions.vector, integer, double precision, uuid, uuid) TO authenticated;
