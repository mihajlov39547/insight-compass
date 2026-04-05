-- Roll back storage-table cleanup trigger.
-- Supabase blocks direct DELETEs on storage.objects from user-driven DML paths,
-- which causes document row deletion to fail with 403.

DROP TRIGGER IF EXISTS trg_cleanup_document_storage_object ON public.documents;
DROP FUNCTION IF EXISTS public.cleanup_document_storage_object();
