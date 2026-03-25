CREATE OR REPLACE FUNCTION public.get_document_question_stats(doc_ids uuid[])
RETURNS TABLE(
  document_id uuid,
  question_count bigint,
  embedded_question_count bigint,
  chunks_with_questions_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT
    dcq.document_id,
    COUNT(*)::bigint AS question_count,
    COUNT(dcq.embedding)::bigint AS embedded_question_count,
    COUNT(DISTINCT dcq.chunk_id)::bigint AS chunks_with_questions_count
  FROM public.document_chunk_questions dcq
  WHERE dcq.document_id = ANY(doc_ids)
    AND dcq.user_id = auth.uid()
  GROUP BY dcq.document_id;
$$;
