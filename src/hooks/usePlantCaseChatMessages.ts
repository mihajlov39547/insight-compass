import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export interface PlantCaseChatMessage {
  id: string;
  user_id: string;
  case_id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export function usePlantCaseChatMessages(caseId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['plant-case-chat-messages', caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plant_case_chat_messages')
        .select('*')
        .eq('case_id', caseId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PlantCaseChatMessage[];
    },
    enabled: !!user && !!caseId,
  });
}

export function useInvalidatePlantCaseChatMessages() {
  const qc = useQueryClient();
  return (caseId: string) =>
    qc.invalidateQueries({ queryKey: ['plant-case-chat-messages', caseId] });
}
