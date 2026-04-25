import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export interface InboxMessage {
  id: string;
  user_id: string;
  kind: 'message' | 'share_invitation' | 'system' | 'admin';
  title: string;
  body: string | null;
  action_label: string | null;
  action_url: string | null;
  metadata: Record<string, unknown>;
  read_at: string | null;
  is_read: boolean;
  created_at: string;
  updated_at: string;
}

export function useInboxMessages(enabled = true) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['inbox-messages', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_inbox_messages' as any)
        .select('id, user_id, kind, title, body, action_label, action_url, metadata, read_at, is_read, created_at, updated_at')
        .order('is_read', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as InboxMessage[];
    },
    enabled: enabled && !!user,
    staleTime: 30 * 1000,
  });
}

export function useInboxUnreadCount() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['inbox-unread-count', user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('user_inbox_messages' as any)
        .select('id', { count: 'exact', head: true })
        .is('read_at', null);

      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user,
    staleTime: 30 * 1000,
  });
}

export function useSetInboxMessageReadState() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ id, read }: { id: string; read: boolean }) => {
      const { error } = await supabase
        .from('user_inbox_messages' as any)
        .update({ read_at: read ? new Date().toISOString() : null })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox-messages', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['inbox-unread-count', user?.id] });
    },
  });
}
