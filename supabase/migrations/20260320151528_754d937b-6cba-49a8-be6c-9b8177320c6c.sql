-- Add processing columns to documents table
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'uploaded',
  ADD COLUMN IF NOT EXISTS processing_error text,
  ADD COLUMN IF NOT EXISTS detected_language text,
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS page_count integer,
  ADD COLUMN IF NOT EXISTS word_count integer,
  ADD COLUMN IF NOT EXISTS char_count integer;

-- Create document_analysis table for full extracted content and search index
CREATE TABLE IF NOT EXISTS public.document_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  extracted_text text,
  normalized_search_text text,
  metadata_json jsonb DEFAULT '{}'::jsonb,
  ocr_used boolean DEFAULT false,
  indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id)
);

ALTER TABLE public.document_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own analysis" ON public.document_analysis
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own analysis" ON public.document_analysis
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own analysis" ON public.document_analysis
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own analysis" ON public.document_analysis
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Allow updates on documents table (for processing_status updates)
CREATE POLICY "Users can update their own documents" ON public.documents
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);