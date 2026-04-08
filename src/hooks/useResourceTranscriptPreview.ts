import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface TranscriptPreviewChunk {
  chunkIndex: number;
  chunkText: string;
  tokenCount: number;
  matchRank: number | null;
}

export function useResourceTranscriptPreview(resourceId: string | null, query: string, enabled = true) {
  return useQuery({
    queryKey: ['resource-transcript-preview', resourceId, query],
    enabled: enabled && !!resourceId,
    queryFn: async (): Promise<TranscriptPreviewChunk[]> => {
      if (!resourceId) return [];

      const { data, error } = await supabase.rpc('get_link_transcript_preview' as any, {
        p_resource_id: resourceId,
        p_limit: 50,
        p_query: query.trim() ? query.trim() : null,
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
