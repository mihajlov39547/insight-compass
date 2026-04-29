-- Revoke anon execute from internal vector search RPCs (only called server-side)
REVOKE EXECUTE ON FUNCTION public.search_document_chunks(extensions.vector, integer, double precision, uuid, uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.search_document_chunk_questions(extensions.vector, integer, double precision, uuid, uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.search_link_transcript_chunks(extensions.vector, integer, double precision, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_link_transcript_chunk_questions(extensions.vector, integer, double precision, uuid, uuid) FROM anon;