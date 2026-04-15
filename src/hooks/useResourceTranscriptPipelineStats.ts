import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export interface ResourceTranscriptPipelineStats {
  chunkCount: number;
  embeddingCount: number;
  embeddingCoverage: number;
  questionCount: number;
  embeddedQuestionCount: number;
}

export function useResourceTranscriptPipelineStats(resourceId: string | null, enabled = true) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['resource-transcript-pipeline-stats', resourceId],
    enabled: !!user && !!resourceId && enabled,
    queryFn: async (): Promise<ResourceTranscriptPipelineStats> => {
      if (!resourceId) {
        return {
          chunkCount: 0,
          embeddingCount: 0,
          embeddingCoverage: 0,
          questionCount: 0,
          embeddedQuestionCount: 0,
        };
      }

      const [chunkCountRes, embeddingCountRes, questionCountRes, embeddedQuestionCountRes] = await Promise.all([
        supabase
          .from('link_transcript_chunks' as any)
          .select('*', { count: 'exact', head: true })
          .eq('resource_link_id', resourceId),
        supabase
          .from('link_transcript_chunks' as any)
          .select('*', { count: 'exact', head: true })
          .eq('resource_link_id', resourceId)
          .not('embedding', 'is', null),
        supabase
          .from('link_transcript_chunk_questions' as any)
          .select('*', { count: 'exact', head: true })
          .eq('resource_link_id', resourceId),
        supabase
          .from('link_transcript_chunk_questions' as any)
          .select('*', { count: 'exact', head: true })
          .eq('resource_link_id', resourceId)
          .not('embedding', 'is', null),
      ]);

      if (chunkCountRes.error) throw chunkCountRes.error;
      if (embeddingCountRes.error) throw embeddingCountRes.error;
      if (questionCountRes.error) throw questionCountRes.error;
      if (embeddedQuestionCountRes.error) throw embeddedQuestionCountRes.error;

      const chunkCount = chunkCountRes.count || 0;
      const embeddingCount = embeddingCountRes.count || 0;
      const questionCount = questionCountRes.count || 0;
      const embeddedQuestionCount = embeddedQuestionCountRes.count || 0;

      return {
        chunkCount,
        embeddingCount,
        embeddingCoverage: chunkCount > 0 ? Math.round((embeddingCount / chunkCount) * 100) : 0,
        questionCount,
        embeddedQuestionCount,
      };
    },
    staleTime: 10_000,
  });
}
