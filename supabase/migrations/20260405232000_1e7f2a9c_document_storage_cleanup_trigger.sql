-- Ensure storage files are removed whenever a document row is deleted,
-- including cascade deletes from chat/project/notebook deletions.

CREATE OR REPLACE FUNCTION public.cleanup_document_storage_object()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.storage_path IS NOT NULL AND OLD.storage_path <> '' THEN
    DELETE FROM storage.objects
    WHERE bucket_id = 'insight-navigator'
      AND (name = OLD.storage_path OR name = ltrim(OLD.storage_path, '/'));
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_document_storage_object ON public.documents;

CREATE TRIGGER trg_cleanup_document_storage_object
AFTER DELETE ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_document_storage_object();
