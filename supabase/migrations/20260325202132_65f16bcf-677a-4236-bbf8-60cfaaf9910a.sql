
-- =============================================================
-- Phase 1: document_chunk_questions – question-storage layer
-- =============================================================
-- Design: Normalized child table of document_chunks.
-- Each chunk may have 0-3 generated questions (position 1..3).
-- Embeddings use vector(1536) matching the existing chunk vectors.
-- RLS mirrors the ownership model: user_id on the parent chunk.
-- =============================================================

-- 1. Create the table
CREATE TABLE public.document_chunk_questions (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id       uuid           NOT NULL REFERENCES public.document_chunks(id) ON DELETE CASCADE,
  document_id    uuid           NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id        uuid           NOT NULL,                -- denormalized for RLS; must match chunk owner
  question_text  text           NOT NULL,
  position       integer        NOT NULL,
  embedding      extensions.vector(1536),
  generation_model   text,
  embedding_version  text,
  is_grounded    boolean        NOT NULL DEFAULT true,
  project_id     uuid,          -- optional scope, mirrors document_chunks
  chat_id        uuid,          -- optional scope
  notebook_id    uuid,          -- optional scope
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now(),

  -- Data-integrity: one question per position per chunk, position 1-3
  CONSTRAINT dcq_position_range CHECK (position BETWEEN 1 AND 3),
  CONSTRAINT dcq_unique_chunk_position UNIQUE (chunk_id, position),
  CONSTRAINT dcq_question_not_blank CHECK (trim(question_text) <> '')
);

-- 2. B-tree indexes for common lookups
CREATE INDEX idx_dcq_chunk_id    ON public.document_chunk_questions (chunk_id);
CREATE INDEX idx_dcq_document_id ON public.document_chunk_questions (document_id);
CREATE INDEX idx_dcq_user_id     ON public.document_chunk_questions (user_id);

-- 3. pgvector index – cosine similarity, matching existing search_document_chunks (<=>)
CREATE INDEX idx_dcq_embedding ON public.document_chunk_questions
  USING ivfflat (embedding extensions.vector_cosine_ops)
  WITH (lists = 100);

-- 4. updated_at trigger – reuses the existing update_updated_at_column() function
CREATE TRIGGER set_dcq_updated_at
  BEFORE UPDATE ON public.document_chunk_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 5. RLS – ownership via user_id, consistent with documents & document_chunks
ALTER TABLE public.document_chunk_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own chunk questions"
  ON public.document_chunk_questions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own chunk questions"
  ON public.document_chunk_questions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own chunk questions"
  ON public.document_chunk_questions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own chunk questions"
  ON public.document_chunk_questions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 6. Lightweight stats RPC – mirrors get_document_chunk_stats pattern
CREATE OR REPLACE FUNCTION public.get_document_question_stats(doc_ids uuid[])
  RETURNS TABLE(document_id uuid, question_count bigint, embedded_question_count bigint)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = 'public'
AS $$
  SELECT
    dcq.document_id,
    COUNT(*)::bigint           AS question_count,
    COUNT(dcq.embedding)::bigint AS embedded_question_count
  FROM public.document_chunk_questions dcq
  WHERE dcq.document_id = ANY(doc_ids)
    AND dcq.user_id = auth.uid()
  GROUP BY dcq.document_id;
$$;
