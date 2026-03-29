import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

interface ChatPreview {
  chatId: string;
  docCount: number;
  lastMessage: string | null;
}

export function useChatPreviews(chatIds: string[]) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['chat-previews', chatIds],
    queryFn: async (): Promise<Record<string, ChatPreview>> => {
      if (chatIds.length === 0) return {};

      // Fetch doc counts per chat
      const { data: docs } = await supabase
        .from('documents' as any)
        .select('chat_id')
        .in('chat_id', chatIds);

      const docCounts: Record<string, number> = {};
      (docs || []).forEach((d: any) => {
        docCounts[d.chat_id] = (docCounts[d.chat_id] || 0) + 1;
      });

      // Fetch latest non-welcome message per chat (get recent messages)
      const { data: messages } = await supabase
        .from('messages')
        .select('chat_id, content, role')
        .in('chat_id', chatIds)
        .order('created_at', { ascending: false })
        .limit(chatIds.length * 3);

      const latestMsg: Record<string, string> = {};
      (messages || []).forEach((m: any) => {
        if (!latestMsg[m.chat_id]) {
          // Skip default welcome messages
          if (m.role === 'assistant' && m.content.startsWith('Welcome! I can help you')) return;
          latestMsg[m.chat_id] = m.content;
        }
      });

      const result: Record<string, ChatPreview> = {};
      chatIds.forEach(id => {
        result[id] = {
          chatId: id,
          docCount: docCounts[id] || 0,
          lastMessage: latestMsg[id] || null,
        };
      });
      return result;
    },
    enabled: !!user && chatIds.length > 0,
    staleTime: 30000,
  });
}
