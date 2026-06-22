
CREATE OR REPLACE FUNCTION public.list_stale_external_reference_temp_files()
RETURNS TABLE(document_id uuid, storage_path text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT d.id, d.storage_path
  FROM public.documents d
  WHERE d.storage_mode = 'external_reference'
    AND d.storage_path IS NOT NULL
    AND d.storage_path <> ''
    AND (
      d.processing_status = 'failed'
      OR d.updated_at < (now() - interval '24 hours')
    );
$$;

CREATE OR REPLACE FUNCTION public.clear_external_reference_storage_paths(_document_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.documents
  SET storage_path = NULL
  WHERE id = ANY(_document_ids)
    AND storage_mode = 'external_reference';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.list_stale_external_reference_temp_files() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_external_reference_storage_paths(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_stale_external_reference_temp_files() TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_external_reference_storage_paths(uuid[]) TO service_role;
