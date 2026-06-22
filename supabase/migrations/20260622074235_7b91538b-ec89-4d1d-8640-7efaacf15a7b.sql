ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS storage_mode text NOT NULL DEFAULT 'stored_copy';

CREATE INDEX IF NOT EXISTS idx_documents_storage_mode
  ON public.documents (storage_mode)
  WHERE storage_mode = 'external_reference';