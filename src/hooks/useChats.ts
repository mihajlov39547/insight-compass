import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';
import type { AvailableLanguageCode } from '@/lib/languages';

export interface DbChat {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  language: string;
  created_at: string;
  updated_at: string;
}

export function useChats(projectId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['chats', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chats')
        .select('*')
        .eq('project_id', projectId!)
        .eq('is_archived', false)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as DbChat[];
    },
    enabled: !!user && !!projectId,
  });
}

const WELCOME_MESSAGE = `Welcome! I can help you explore and work with the information in this project. You can upload files, build a knowledge base, ask questions about your documents, and get grounded answers based on the content available here. To get started, add files to this chat or project, then ask a question, request a summary, or explore key insights.`;

export function useCreateChat() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ projectId, name, language }: { projectId: string; name: string; language: AvailableLanguageCode }) => {
      const { data, error } = await supabase
        .from('chats')
        .insert({ project_id: projectId, user_id: user!.id, name, language })
        .select()
        .single();
      if (error) throw error;

      // Insert welcome assistant message
      await supabase.from('messages').insert({
        chat_id: data.id,
        user_id: user!.id,
        role: 'assistant',
        content: WELCOME_MESSAGE,
        sources: [],
      });

      return data as DbChat;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['chats', data.project_id] });
      qc.invalidateQueries({ queryKey: ['messages', data.id] });
      supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', data.project_id).then(() => {
        qc.invalidateQueries({ queryKey: ['projects'] });
      });
    },
  });
}

export function useUpdateChat() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<DbChat> & { id: string }) => {
      const { data, error } = await supabase
        .from('chats')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as DbChat;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['chats', data.project_id] });
    },
  });
}

export function useDeleteChat() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, projectId }: { id: string; projectId: string }) => {
      // Gather storage paths for documents attached to this chat
      const { data: chatDocs, error: docsError } = await supabase
        .from('documents' as any)
        .select('id, storage_path')
        .eq('chat_id', id);
      if (docsError) throw docsError;

      const docs = (chatDocs ?? []) as unknown as Array<{ id: string; storage_path: string }>;
      const storagePaths = docs
        .map((d) => d.storage_path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0);

      // Remove files from storage (DB rows cascade-delete automatically via FK)
      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('insight-navigator')
          .remove(storagePaths);
        if (storageError && !/not found/i.test(storageError.message || '')) {
          throw storageError;
        }
      }

      // Delete chat — cascades to: messages, documents → analysis/chunks/chunk_questions
      const { error } = await supabase.from('chats').delete().eq('id', id);
      if (error) throw error;
      return { projectId };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['chats', data.projectId] });
      qc.invalidateQueries({ queryKey: ['documents', data.projectId] });
      qc.invalidateQueries({ queryKey: ['document-count', data.projectId] });
    },
  });
}
