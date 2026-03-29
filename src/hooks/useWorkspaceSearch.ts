import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export interface DocumentSearchResult {
  document_id: string;
  file_name: string;
  project_id: string;
  chat_id: string | null;
  summary: string | null;
  processing_status: string;
  snippet: string | null;
  rank: number;
}

export interface ChatSearchResult {
  id: string;
  name: string;
  project_id: string;
  updated_at: string;
}

export interface ProjectSearchResult {
  id: string;
  name: string;
  description: string;
}

export interface WorkspaceSearchResults {
  projects: ProjectSearchResult[];
  chats: ChatSearchResult[];
  documents: DocumentSearchResult[];
}

export function useWorkspaceSearch(query: string) {
  const { user } = useAuth();
  const trimmed = query.trim();

  return useQuery({
    queryKey: ['workspace-search', trimmed],
    queryFn: async (): Promise<WorkspaceSearchResults> => {
      if (!trimmed) return { projects: [], chats: [], documents: [] };

      const lowerQuery = `%${trimmed}%`;

      // Run all three searches in parallel
      const [projectsRes, chatsRes, docsRes] = await Promise.all([
        supabase
          .from('projects')
          .select('id, name, description')
          .eq('is_archived', false)
          .or(`name.ilike.${lowerQuery},description.ilike.${lowerQuery}`)
          .limit(10),
        supabase
          .from('chats')
          .select('id, name, project_id, updated_at')
          .eq('is_archived', false)
          .ilike('name', lowerQuery)
          .limit(10),
        supabase.rpc('search_documents', { search_query: trimmed }),
      ]);

      return {
        projects: (projectsRes.data ?? []) as ProjectSearchResult[],
        chats: (chatsRes.data ?? []) as ChatSearchResult[],
        documents: (docsRes.data ?? []) as unknown as DocumentSearchResult[],
      };
    },
    enabled: !!user && trimmed.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
