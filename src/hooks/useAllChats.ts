import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export interface AllChat {
  id: string;
  project_id: string;
}

export function useChats() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['all-chats', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chats')
        .select('id, project_id')
        .eq('is_archived', false);
      if (error) throw error;
      return (data ?? []) as AllChat[];
    },
    enabled: !!user,
  });
}
