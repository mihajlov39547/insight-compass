
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Create document_chunks table
CREATE TABLE public.document_chunks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  chat_id uuid REFERENCES public.chats(id) ON DELETE SET NULL,
  notebook_id uuid REFERENCES public.notebooks(id) ON DELETE SET NULL,
  chunk_index integer NOT NULL,
  chunk_text text NOT NULL,
  embedding vector(1536),
  page integer,
  section text,
  token_count integer,
  language text,
  metadata_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Indexes for efficient lookup and future filtered vector search
CREATE INDEX idx_document_chunks_document_id ON public.document_chunks(document_id);
CREATE INDEX idx_document_chunks_user_id ON public.document_chunks(user_id);
CREATE INDEX idx_document_chunks_project_id ON public.document_chunks(project_id);
CREATE INDEX idx_document_chunks_chat_id ON public.document_chunks(chat_id);
CREATE INDEX idx_document_chunks_notebook_id ON public.document_chunks(notebook_id);
CREATE INDEX idx_document_chunks_document_chunk ON public.document_chunks(document_id, chunk_index);

-- Enable RLS
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

-- RLS policies matching document ownership model
CREATE POLICY "Users can view their own chunks"
  ON public.document_chunks FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own chunks"
  ON public.document_chunks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own chunks"
  ON public.document_chunks FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own chunks"
  ON public.document_chunks FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Auto-update updated_at trigger
CREATE TRIGGER update_document_chunks_updated_at
  BEFORE UPDATE ON public.document_chunks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
