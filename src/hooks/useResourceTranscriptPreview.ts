import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface TranscriptPreviewChunk {
  chunkIndex: number;
  chunkText: string;
  tokenCount: number;
  matchRank: number | null;
}

export function useResourceTranscriptPreview(resourceId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['resource-transcript-preview', resourceId],
    enabled: enabled && !!resourceId,
    queryFn: async (): Promise<TranscriptPreviewChunk[]> => {
      if (!resourceId) return [];

      const { data, error } = await supabase.rpc('get_link_transcript_preview' as any, {
        p_resource_id: resourceId,
        p_limit: 1000,
        p_query: null,
      });

      if (error) throw error;

      return (data || []).map((row: any) => ({
        chunkIndex: row.chunk_index,
        chunkText: row.chunk_text,
        tokenCount: Number(row.token_count || 0),
        matchRank: row.match_rank === null || row.match_rank === undefined ? null : Number(row.match_rank),
      }));
    },
    staleTime: 15_000,
  });
}
