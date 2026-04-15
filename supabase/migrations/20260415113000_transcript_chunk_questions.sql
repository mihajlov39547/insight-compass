CREATE TABLE IF NOT EXISTS public.link_transcript_chunk_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id uuid NOT NULL REFERENCES public.link_transcript_chunks(id) ON DELETE CASCADE,
  resource_link_id uuid NOT NULL REFERENCES public.resource_links(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  project_id uuid NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  notebook_id uuid NULL REFERENCES public.notebooks(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  position integer NOT NULL DEFAULT 1,
  embedding extensions.vector(1536) NULL,
  generation_model text NULL,
  embedding_version text NULL,
  is_grounded boolean NOT NULL DEFAULT true,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(question_text, ''))) STORED,
  UNIQUE(chunk_id, position)
);

ALTER TABLE public.link_transcript_chunk_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view accessible transcript chunk questions" ON public.link_transcript_chunk_questions;
CREATE POLICY "Users can view accessible transcript chunk questions"
ON public.link_transcript_chunk_questions FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR (project_id IS NOT NULL AND public.check_item_permission(auth.uid(), project_id, 'project', 'viewer'))
  OR (notebook_id IS NOT NULL AND public.check_item_permission(auth.uid(), notebook_id, 'notebook', 'viewer'))
);

DROP TRIGGER IF EXISTS update_link_transcript_chunk_questions_updated_at ON public.link_transcript_chunk_questions;
CREATE TRIGGER update_link_transcript_chunk_questions_updated_at
  BEFORE UPDATE ON public.link_transcript_chunk_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_ltcq_resource_link_id
  ON public.link_transcript_chunk_questions(resource_link_id);

CREATE INDEX IF NOT EXISTS idx_ltcq_chunk_id
  ON public.link_transcript_chunk_questions(chunk_id);

CREATE INDEX IF NOT EXISTS idx_ltcq_search_vector
  ON public.link_transcript_chunk_questions USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS idx_ltcq_embedding
  ON public.link_transcript_chunk_questions USING ivfflat (embedding extensions.vector_cosine_ops)
  WITH (lists = 100);

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
    AND (filter_notebook_id IS NULL OR q.notebook_id = filter_notebook_id)
    AND (1 - (q.embedding <=> query_embedding))::float >= similarity_threshold
  ORDER BY q.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.search_link_transcript_chunk_questions(extensions.vector, integer, double precision, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_link_transcript_chunk_questions(extensions.vector, integer, double precision, uuid, uuid) TO authenticated;
