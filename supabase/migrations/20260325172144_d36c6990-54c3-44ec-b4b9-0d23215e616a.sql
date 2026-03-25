
-- Drop the failed function if it exists partially
DROP FUNCTION IF EXISTS public.search_document_chunks(vector(1536), integer, float, uuid, uuid, uuid);

-- Recreate with extensions in search_path for pgvector operators
CREATE OR REPLACE FUNCTION public.search_document_chunks(
  query_embedding extensions.vector(1536),
  match_count integer DEFAULT 10,
  similarity_threshold float DEFAULT 0.0,
  filter_project_id uuid DEFAULT NULL,
  filter_notebook_id uuid DEFAULT NULL,
  filter_chat_id uuid DEFAULT NULL
)
RETURNS TABLE(
  chunk_id uuid,
  document_id uuid,
  project_id uuid,
  chat_id uuid,
  notebook_id uuid,
  chunk_index integer,
  chunk_text text,
  similarity float,
  page integer,
  section text,
  language text,
  token_count integer,
  file_name text,
  metadata_json jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    dc.id AS chunk_id,
    dc.document_id,
    dc.project_id,
    dc.chat_id,
    dc.notebook_id,
    dc.chunk_index,
    dc.chunk_text,
    (1 - (dc.embedding <=> query_embedding))::float AS similarity,
    dc.page,
    dc.section,
    dc.language,
    dc.token_count,
    d.file_name,
    dc.metadata_json
  FROM public.document_chunks dc
  JOIN public.documents d ON d.id = dc.document_id
  WHERE
    dc.user_id = auth.uid()
    AND dc.embedding IS NOT NULL
    AND (filter_project_id IS NULL OR dc.project_id = filter_project_id)
    AND (filter_notebook_id IS NULL OR (
      dc.notebook_id = filter_notebook_id
      AND d.notebook_enabled = true
    ))
    AND (filter_chat_id IS NULL OR dc.chat_id = filter_chat_id)
    AND (1 - (dc.embedding <=> query_embedding))::float >= similarity_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;
