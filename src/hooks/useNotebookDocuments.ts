import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { DbDocument } from '@/hooks/useDocuments';

const PROCESSING_STATES = new Set([
  'uploaded', 'extracting_metadata', 'extracting_content',
  'detecting_language', 'summarizing', 'indexing',
]);

export function useNotebookDocuments(notebookId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['notebook-documents', notebookId],
    queryFn: async () => {
      if (!notebookId) return [];
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('notebook_id', notebookId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as DbDocument[];
    },
    enabled: !!user && !!notebookId,
    refetchInterval: (query) => {
      const docs = query.state.data as DbDocument[] | undefined;
      if (docs?.some(d => PROCESSING_STATES.has(d.processing_status))) return 4000;
      return false;
    },
  });
}
