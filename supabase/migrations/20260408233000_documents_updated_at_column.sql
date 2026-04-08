ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.documents
SET updated_at = created_at
WHERE updated_at IS NULL;

ALTER TABLE public.documents
ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.documents
ALTER COLUMN updated_at SET NOT NULL;

DROP TRIGGER IF EXISTS update_documents_updated_at ON public.documents;

CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
