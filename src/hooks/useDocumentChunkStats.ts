import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export interface ChunkStats {
  documentId: string;
  chunkCount: number;
  embeddedCount: number;
  avgTokenCount: number | null;
}

/**
 * Fetches chunk/embedding stats for a list of document IDs
 * using a lightweight server-side function (avoids transferring full embedding vectors).
 */
export function useDocumentChunkStats(documentIds: string[]) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['document-chunk-stats', ...documentIds.sort()],
    queryFn: async () => {
      if (documentIds.length === 0) return new Map<string, ChunkStats>();

      const { data, error } = await supabase.rpc('get_document_chunk_stats', {
        doc_ids: documentIds,
      });

      if (error) throw error;

      const statsMap = new Map<string, ChunkStats>();

      // Initialize all requested IDs with zeros
      for (const docId of documentIds) {
        statsMap.set(docId, {
          documentId: docId,
          chunkCount: 0,
          embeddedCount: 0,
          avgTokenCount: null,
        });
      }

      // Fill in real data from the RPC response
      for (const row of (data || [])) {
        statsMap.set(row.document_id, {
          documentId: row.document_id,
          chunkCount: Number(row.chunk_count),
          embeddedCount: Number(row.embedded_count),
          avgTokenCount: row.avg_token_count != null ? Number(row.avg_token_count) : null,
        });
      }

      return statsMap;
    },
    enabled: !!user && documentIds.length > 0,
    staleTime: 10_000,
  });
}
