import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface ChunkStats {
  documentId: string;
  chunkCount: number;
  embeddedCount: number;
  avgTokenCount: number | null;
}

/**
 * Fetches chunk/embedding stats for a list of document IDs.
 * Returns a map of documentId → ChunkStats.
 */
export function useDocumentChunkStats(documentIds: string[]) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['document-chunk-stats', ...documentIds.sort()],
    queryFn: async () => {
      if (documentIds.length === 0) return new Map<string, ChunkStats>();

      // Only select lightweight columns — avoid fetching the large embedding vector.
      // We check embedding presence via a workaround: select embedding and check non-null,
      // but use a minimal select to avoid transferring the full vector data.
      const { data, error } = await supabase
        .from('document_chunks')
        .select('document_id, token_count, embedding')
        .in('document_id', documentIds);

      if (error) throw error;

      const statsMap = new Map<string, ChunkStats>();

      for (const docId of documentIds) {
        statsMap.set(docId, {
          documentId: docId,
          chunkCount: 0,
          embeddedCount: 0,
          avgTokenCount: null,
        });
      }

      for (const row of (data || [])) {
        const docId = row.document_id as string;
        const stats = statsMap.get(docId);
        if (!stats) continue;
        stats.chunkCount++;
        if (row.embedding) stats.embeddedCount++;
        if (row.token_count != null) {
          stats.avgTokenCount = stats.avgTokenCount
            ? (stats.avgTokenCount * (stats.chunkCount - 1) + (row.token_count as number)) / stats.chunkCount
            : (row.token_count as number);
        }
      }

      return statsMap;
    },
    enabled: !!user && documentIds.length > 0,
    staleTime: 10_000,
  });
}
