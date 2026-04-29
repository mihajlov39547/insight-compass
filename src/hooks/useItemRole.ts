import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';
import type { ItemRole } from '@/lib/permissions';

/**
 * Returns the current user's role for a given project or notebook.
 * Checks ownership first, then share records.
 */
export function useItemRole(
  itemId: string | null | undefined,
  itemType: 'project' | 'notebook'
) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['item-role', itemType, itemId, user?.id],
    queryFn: async (): Promise<ItemRole | null> => {
      if (!itemId || !user) return null;

      // Check ownership by querying the item directly
      if (itemType === 'project') {
        const { data: project } = await supabase
          .from('projects')
          .select('user_id')
          .eq('id', itemId)
          .maybeSingle();
        if (project?.user_id === user.id) return 'owner';
      } else {
        const { data: notebook } = await supabase
          .from('notebooks' as any)
          .select('user_id')
          .eq('id', itemId)
          .maybeSingle();
        if ((notebook as any)?.user_id === user.id) return 'owner';
      }

      // Check share record
      const { data: share } = await supabase
        .from('shares')
        .select('permission')
        .eq('item_id', itemId)
        .eq('item_type', itemType)
        .eq('shared_with_user_id', user.id)
        .maybeSingle();

      if (share?.permission) {
        return share.permission as ItemRole;
      }

      return null;
    },
    enabled: !!itemId && !!user,
    staleTime: 30_000,
  });
}

/**
 * Fetches all share members for a given project or notebook.
 */
export interface ShareMember {
  shareId: string;
  userId: string | null;
  email: string | null;
  permission: string;
  createdAt: string;
  // Profile data
  fullName: string | null;
  username: string | null;
  avatarUrl: string | null;
}

export function useShareMembers(
  itemId: string | null | undefined,
  itemType: 'project' | 'notebook'
) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['share-members', itemType, itemId],
    queryFn: async (): Promise<ShareMember[]> => {
      if (!itemId) return [];

      const { data: shares, error } = await supabase
        .from('shares')
        .select('*')
        .eq('item_id', itemId)
        .eq('item_type', itemType)
        .order('created_at', { ascending: true });

      if (error) throw error;
      if (!shares || shares.length === 0) return [];

      // Fetch profiles for users with user_ids
      const userIds = shares
        .map(s => s.shared_with_user_id)
        .filter((id): id is string => !!id);

      let profileMap = new Map<string, any>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .rpc('get_public_profiles', { _user_ids: userIds });
        profileMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
      }

      return shares.map(s => {
        const profile = s.shared_with_user_id ? profileMap.get(s.shared_with_user_id) : null;
        return {
          shareId: s.id,
          userId: s.shared_with_user_id,
          email: s.shared_with_email || profile?.email || null,
          permission: s.permission,
          createdAt: s.created_at,
          fullName: profile?.full_name || null,
          username: profile?.username || null,
          avatarUrl: profile?.avatar_url || null,
        };
      });
    },
    enabled: !!itemId && !!user,
  });
}
