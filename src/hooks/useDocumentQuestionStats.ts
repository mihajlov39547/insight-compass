import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export interface QuestionStats {
  documentId: string;
  questionCount: number;
  embeddedQuestionCount: number;
  chunksWithQuestionsCount: number;
}

/**
 * Fetches question-generation stats for a list of document IDs
 * using lightweight server-side aggregation (no vectors transferred).
 */
export function useDocumentQuestionStats(documentIds: string[]) {
  const { user } = useAuth();

  const toSafeCount = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  };

  return useQuery({
    queryKey: ['document-question-stats', ...documentIds.sort()],
    queryFn: async () => {
      if (documentIds.length === 0) return new Map<string, QuestionStats>();

      const { data, error } = await supabase.rpc('get_document_question_stats', {
        doc_ids: documentIds,
      });

      if (error) throw error;

      const statsMap = new Map<string, QuestionStats>();

      // Initialize all requested IDs with zeros
      for (const docId of documentIds) {
        statsMap.set(docId, {
          documentId: docId,
          questionCount: 0,
          embeddedQuestionCount: 0,
          chunksWithQuestionsCount: 0,
        });
      }

      // Fill in actual values from RPC response
      for (const row of (data || [])) {
        statsMap.set(row.document_id, {
          documentId: row.document_id,
          questionCount: toSafeCount(row.question_count),
          embeddedQuestionCount: toSafeCount(row.embedded_question_count),
          // Runtime-safe for environments where RPC schema may still return old shape
          chunksWithQuestionsCount: toSafeCount((row as any).chunks_with_questions_count),
        });
      }

      return statsMap;
    },
    enabled: !!user && documentIds.length > 0,
    staleTime: 10_000,
  });
}
