import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';
import { mapRpcRowToResource, type Resource } from '@/lib/resourceClassification';

const PROCESSING_STATES = new Set([
  'uploaded', 'extracting_metadata', 'extracting_content',
  'detecting_language', 'summarizing', 'indexing',
  'chunking', 'generating_embeddings', 'generating_chunk_questions',
  'pending', 'queued', 'claimed', 'running', 'waiting_retry',
]);

export function useResources() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['resources', user?.id],
    queryFn: async (): Promise<Resource[]> => {
      const { data, error } = await supabase.rpc('get_user_resources' as any);
      if (error) throw error;
      return ((data as any[]) || []).map(mapRpcRowToResource);
    },
    enabled: !!user,
    refetchInterval: (query) => {
      const resources = query.state.data as Resource[] | undefined;
      if (resources?.some(r => PROCESSING_STATES.has(r.processingStatus))) return 5000;
      return false;
    },
  });
}
