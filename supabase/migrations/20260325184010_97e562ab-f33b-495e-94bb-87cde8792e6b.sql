CREATE OR REPLACE FUNCTION public.get_document_chunk_stats(doc_ids uuid[])
RETURNS TABLE(document_id uuid, chunk_count bigint, embedded_count bigint, avg_token_count numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT
    dc.document_id,
    COUNT(*)::bigint AS chunk_count,
    COUNT(dc.embedding)::bigint AS embedded_count,
    AVG(dc.token_count)::numeric AS avg_token_count
  FROM public.document_chunks dc
  WHERE dc.document_id = ANY(doc_ids)
    AND dc.user_id = auth.uid()
  GROUP BY dc.document_id;
$$;