CREATE OR REPLACE FUNCTION public.search_document_chunk_questions(
  query_embedding extensions.vector(1536),
  match_count integer DEFAULT 20,
  similarity_threshold float DEFAULT 0.0,
  filter_project_id uuid DEFAULT NULL,
  filter_notebook_id uuid DEFAULT NULL,
  filter_chat_id uuid DEFAULT NULL
)
RETURNS TABLE(
  question_id uuid,
  chunk_id uuid,
  document_id uuid,
  project_id uuid,
  chat_id uuid,
  notebook_id uuid,
  chunk_index integer,
  chunk_text text,
  question_text text,
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
    dcq.id AS question_id,
    dc.id AS chunk_id,
    dc.document_id,
    dc.project_id,
    dc.chat_id,
    dc.notebook_id,
    dc.chunk_index,
    dc.chunk_text,
    dcq.question_text,
    (1 - (dcq.embedding <=> query_embedding))::float AS similarity,
    dc.page,
    dc.section,
    dc.language,
    dc.token_count,
    d.file_name,
    dc.metadata_json
  FROM public.document_chunk_questions dcq
  JOIN public.document_chunks dc ON dc.id = dcq.chunk_id
  JOIN public.documents d ON d.id = dc.document_id
  WHERE
    dcq.user_id = auth.uid()
    AND dcq.embedding IS NOT NULL
    AND (filter_project_id IS NULL OR dc.project_id = filter_project_id)
    AND (filter_notebook_id IS NULL OR (
      dc.notebook_id = filter_notebook_id
      AND d.notebook_enabled = true
    ))
    AND (filter_chat_id IS NULL OR dc.chat_id = filter_chat_id)
    AND (1 - (dcq.embedding <=> query_embedding))::float >= similarity_threshold
  ORDER BY dcq.embedding <=> query_embedding
  LIMIT match_count;
$$;
