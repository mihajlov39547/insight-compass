import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export interface SharedItem {
  id: string;
  item_type: 'project' | 'notebook';
  item_id: string;
  shared_by_user_id: string;
  shared_with_user_id: string;
  permission: string;
  created_at: string;
  // Joined data
  item_name?: string;
  item_description?: string;
  item_updated_at?: string;
  shared_by_name?: string;
  shared_by_avatar?: string;
}

export function useSharedItems() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['shared-items', user?.id],
    queryFn: async () => {
      // Get shares where current user is the recipient
      const { data: shares, error } = await supabase
        .from('shares')
        .select('*')
        .eq('shared_with_user_id', user!.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (!shares || shares.length === 0) return [] as SharedItem[];

      // Get unique sharer IDs to fetch their profiles
      const sharerIds = [...new Set(shares.map(s => s.shared_by_user_id))];
      const { data: sharerProfiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, avatar_url')
        .in('user_id', sharerIds);

      const profileMap = new Map(
        (sharerProfiles ?? []).map(p => [p.user_id, p])
      );

      // Get project details for shared projects
      const projectIds = shares.filter(s => s.item_type === 'project').map(s => s.item_id);
      const notebookIds = shares.filter(s => s.item_type === 'notebook').map(s => s.item_id);

      let projectMap = new Map<string, { name: string; description: string; updated_at: string }>();
      let notebookMap = new Map<string, { name: string; description: string; updated_at: string }>();

      if (projectIds.length > 0) {
        const { data: projects } = await supabase
          .from('projects')
          .select('id, name, description, updated_at')
          .in('id', projectIds);
        projectMap = new Map((projects ?? []).map(p => [p.id, p]));
      }

      if (notebookIds.length > 0) {
        const { data: notebooks } = await supabase
          .from('notebooks')
          .select('id, name, description, updated_at')
          .in('id', notebookIds);
        notebookMap = new Map((notebooks ?? []).map(n => [n.id, n]));
      }

      return shares.map(s => {
        const itemData = s.item_type === 'project'
          ? projectMap.get(s.item_id)
          : notebookMap.get(s.item_id);
        const sharer = profileMap.get(s.shared_by_user_id);

        return {
          ...s,
          item_type: s.item_type as 'project' | 'notebook',
          item_name: itemData?.name ?? 'Unknown',
          item_description: itemData?.description ?? '',
          item_updated_at: itemData?.updated_at ?? s.created_at,
          shared_by_name: sharer?.full_name ?? 'Unknown',
          shared_by_avatar: sharer?.avatar_url ?? undefined,
        } as SharedItem;
      });
    },
    enabled: !!user,
    staleTime: 30000,
  });
}
