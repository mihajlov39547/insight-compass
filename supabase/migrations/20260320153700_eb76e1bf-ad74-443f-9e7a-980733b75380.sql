
-- Add tsvector column and GIN index for full-text search on document_analysis
ALTER TABLE public.document_analysis ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Populate search_vector from existing data
UPDATE public.document_analysis
SET search_vector = to_tsvector('simple', coalesce(normalized_search_text, ''));

-- Create GIN index
CREATE INDEX IF NOT EXISTS idx_document_analysis_search_vector
ON public.document_analysis USING gin(search_vector);

-- Trigger to auto-update search_vector on insert/update
CREATE OR REPLACE FUNCTION public.update_document_search_vector()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.search_vector := to_tsvector('simple', coalesce(NEW.normalized_search_text, ''));
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_document_analysis_search_vector
BEFORE INSERT OR UPDATE OF normalized_search_text ON public.document_analysis
FOR EACH ROW EXECUTE FUNCTION public.update_document_search_vector();

-- Search function that returns documents matching a query
CREATE OR REPLACE FUNCTION public.search_documents(search_query text)
RETURNS TABLE(
  document_id uuid,
  file_name text,
  project_id uuid,
  chat_id uuid,
  summary text,
  processing_status text,
  snippet text,
  rank real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT
    d.id AS document_id,
    d.file_name,
    d.project_id,
    d.chat_id,
    d.summary,
    d.processing_status,
    CASE
      WHEN da.normalized_search_text IS NOT NULL THEN
        left(ts_headline('simple', da.normalized_search_text, plainto_tsquery('simple', search_query), 'MaxWords=25,MinWords=10,MaxFragments=1'), 150)
      ELSE d.summary
    END AS snippet,
    CASE
      WHEN da.search_vector IS NOT NULL THEN
        ts_rank(da.search_vector, plainto_tsquery('simple', search_query))
      ELSE 0
    END AS rank
  FROM public.documents d
  LEFT JOIN public.document_analysis da ON da.document_id = d.id
  WHERE
    d.user_id = auth.uid()
    AND (
      d.file_name ILIKE '%' || search_query || '%'
      OR d.summary ILIKE '%' || search_query || '%'
      OR (da.search_vector IS NOT NULL AND da.search_vector @@ plainto_tsquery('simple', search_query))
    )
  ORDER BY rank DESC, d.created_at DESC
  LIMIT 20;
$$;
