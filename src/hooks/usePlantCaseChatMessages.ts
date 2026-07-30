import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

/** A source that actually backed an assistant answer (grounding/provider/web). */
export interface PlantChatUsedSource {
  id: string;
  provider: string;
  title: string;
  url?: string | null;
  domain?: string | null;
  score?: number | null;
  sourceType?: string | null;
  authorityScore?: string | null;
  cardKey?: string | null;
  snippet?: string | null;
}

export interface PlantChatMessageMetadata {
  goal?: string | null;
  groundingId?: string | null;
  model?: string | null;
  usedFallback?: boolean;
  usedGrowthGrounding?: boolean;
  kind?: 'extract' | 'crawl' | null;
  sourcesUsed?: PlantChatUsedSource[];
  [key: string]: unknown;
}

export interface PlantCaseChatMessage {
  id: string;
  user_id: string;
  case_id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: PlantChatMessageMetadata | null;
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
