import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export interface DbMessage {
  id: string;
  chat_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: any;
  model_id: string | null;
  created_at: string;
}

export function useMessages(chatId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['messages', chatId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', chatId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as DbMessage[];
    },
    enabled: !!user && !!chatId,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ chatId, role, content, sources, modelId }: {
      chatId: string;
      role: 'user' | 'assistant';
      content: string;
      sources?: any[];
      modelId?: string;
    }) => {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          user_id: user!.id,
          role,
          content,
          sources: sources ?? [],
          model_id: modelId ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as DbMessage;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['messages', data.chat_id] });
      // Touch chat updated_at
      supabase.from('chats').update({ updated_at: new Date().toISOString() }).eq('id', data.chat_id);
    },
  });
}

export function useDeleteMessagePair() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, chatId }: { messageId: string; chatId: string }) => {
      const { data: msg, error: msgError } = await supabase
        .from('messages')
        .select('created_at, role')
        .eq('id', messageId)
        .single();
      if (msgError) throw msgError;

      const { data: nextMsgs, error: nextError } = await supabase
        .from('messages')
        .select('id, role')
        .eq('chat_id', chatId)
        .gt('created_at', msg.created_at)
        .order('created_at', { ascending: true })
        .limit(1);

      const idsToDelete = [messageId];
      if (nextMsgs && nextMsgs.length > 0 && nextMsgs[0].role === 'assistant') {
        idsToDelete.push(nextMsgs[0].id);
      }

      const { error: deleteError } = await supabase
        .from('messages')
        .delete()
        .in('id', idsToDelete);
      if (deleteError) throw deleteError;
      return idsToDelete;
    },
    onSuccess: (_, { chatId }) => {
      qc.invalidateQueries({ queryKey: ['messages', chatId] });
    },
  });
}
