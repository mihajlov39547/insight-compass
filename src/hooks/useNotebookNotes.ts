import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export interface DbNotebookNote {
  id: string;
  notebook_id: string;
  user_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function useNotebookNotes(notebookId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['notebook-notes', notebookId],
    queryFn: async () => {
      if (!notebookId) return [];
      const { data, error } = await (supabase.from('notebook_notes' as any) as any)
        .select('*')
        .eq('notebook_id', notebookId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as DbNotebookNote[];
    },
    enabled: !!user && !!notebookId,
  });
}

export function useCreateNotebookNote() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ notebookId, title, content }: { notebookId: string; title?: string; content?: string }) => {
      const { data, error } = await (supabase.from('notebook_notes' as any) as any)
        .insert({ notebook_id: notebookId, user_id: user!.id, title: title || '', content: content || '' })
        .select()
        .single();
      if (error) throw error;
      return data as DbNotebookNote;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['notebook-notes', vars.notebookId] }),
  });
}

export function useUpdateNotebookNote() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, notebookId, ...updates }: { id: string; notebookId: string; title?: string; content?: string }) => {
      const { data, error } = await (supabase.from('notebook_notes' as any) as any)
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as DbNotebookNote;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['notebook-notes', vars.notebookId] }),
  });
}

export function useDeleteNotebookNote() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, notebookId }: { id: string; notebookId: string }) => {
      const { error } = await (supabase.from('notebook_notes' as any) as any)
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['notebook-notes', vars.notebookId] }),
  });
}
