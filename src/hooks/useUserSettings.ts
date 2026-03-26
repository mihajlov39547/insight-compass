import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface GeneralSettings {
  response_length: string;
  retrieval_depth: string;
  cite_sources: boolean;
  auto_summarize: boolean;
  preferred_model: string;
  show_suggested_prompts: boolean;
  enable_answer_formatting: boolean;
  layout_preference: string;
  language_preference: string;
  retrieval_chunk_weight: number;
  retrieval_question_weight: number;
  retrieval_keyword_weight: number;
  chat_suggestions: boolean;
  generation_sound: string;
  agent_action_notifications: boolean;
}

const DEFAULTS: GeneralSettings = {
  response_length: 'Standard',
  retrieval_depth: 'Medium',
  cite_sources: true,
  auto_summarize: true,
  preferred_model: 'google/gemini-3-flash-preview',
  show_suggested_prompts: true,
  enable_answer_formatting: true,
  layout_preference: 'comfortable',
  language_preference: 'en',
  retrieval_chunk_weight: 0.50,
  retrieval_question_weight: 0.30,
  retrieval_keyword_weight: 0.20,
  chat_suggestions: true,
  generation_sound: 'never',
  agent_action_notifications: true,
};

export function useUserSettings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['user-settings', user?.id],
    queryFn: async () => {
      if (!user) return DEFAULTS;
      const { data, error } = await supabase
        .from('user_settings')
        .select('response_length, retrieval_depth, cite_sources, auto_summarize, preferred_model, show_suggested_prompts, enable_answer_formatting, layout_preference, language_preference, retrieval_chunk_weight, retrieval_question_weight, retrieval_keyword_weight, chat_suggestions, generation_sound, agent_action_notifications')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error || !data) return DEFAULTS;
      return {
        response_length: (data as any).response_length ?? DEFAULTS.response_length,
        retrieval_depth: (data as any).retrieval_depth ?? DEFAULTS.retrieval_depth,
        cite_sources: (data as any).cite_sources ?? DEFAULTS.cite_sources,
        auto_summarize: (data as any).auto_summarize ?? DEFAULTS.auto_summarize,
        preferred_model: (data as any).preferred_model ?? DEFAULTS.preferred_model,
        show_suggested_prompts: (data as any).show_suggested_prompts ?? DEFAULTS.show_suggested_prompts,
        enable_answer_formatting: (data as any).enable_answer_formatting ?? DEFAULTS.enable_answer_formatting,
        layout_preference: (data as any).layout_preference ?? DEFAULTS.layout_preference,
        language_preference: (data as any).language_preference ?? DEFAULTS.language_preference,
        retrieval_chunk_weight: (data as any).retrieval_chunk_weight ?? DEFAULTS.retrieval_chunk_weight,
        retrieval_question_weight: (data as any).retrieval_question_weight ?? DEFAULTS.retrieval_question_weight,
        retrieval_keyword_weight: (data as any).retrieval_keyword_weight ?? DEFAULTS.retrieval_keyword_weight,
        chat_suggestions: (data as any).chat_suggestions ?? DEFAULTS.chat_suggestions,
        generation_sound: (data as any).generation_sound ?? DEFAULTS.generation_sound,
        agent_action_notifications: (data as any).agent_action_notifications ?? DEFAULTS.agent_action_notifications,
      } as GeneralSettings;
    },
    enabled: !!user,
  });
}

export function useSaveUserSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: Partial<GeneralSettings>) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, ...settings } as any, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-settings'] });
    },
  });
}
