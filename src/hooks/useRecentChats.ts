import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface RecentChat {
  id: string;
  name: string;
  project_id: string;
  updated_at: string;
}

export function useRecentChats(limit = 10) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['recent-chats', user?.id, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chats')
        .select('id, name, project_id, updated_at')
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as RecentChat[];
    },
    enabled: !!user,
    staleTime: 30000,
  });
}
