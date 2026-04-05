import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export interface DbProject {
  id: string;
  user_id: string;
  name: string;
  description: string;
  language: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export function useProjects() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['projects', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('is_archived', false)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as DbProject[];
    },
    enabled: !!user,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ name, description, language }: { name: string; description: string; language: string }) => {
      const { data, error } = await supabase
        .from('projects')
        .insert({ user_id: user!.id, name, description, language })
        .select()
        .single();
      if (error) throw error;
      return data as DbProject;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<DbProject> & { id: string }) => {
      const { data, error } = await supabase
        .from('projects')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as DbProject;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useArchiveProject() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // Archive the project
      const { error: projError } = await supabase
        .from('projects')
        .update({ is_archived: true })
        .eq('id', id);
      if (projError) throw projError;

      // Archive all chats belonging to this project
      const { error: chatError } = await supabase
        .from('chats')
        .update({ is_archived: true })
        .eq('project_id', id);
      if (chatError) throw chatError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // Delete all messages for chats in this project
      const { data: chats } = await supabase
        .from('chats')
        .select('id')
        .eq('project_id', id);

      const chatIds = (chats ?? []).map(c => c.id);

      const [{ data: projectDocs, error: projectDocsError }, { data: chatDocs, error: chatDocsError }] = await Promise.all([
        supabase
          .from('documents' as any)
          .select('id, storage_path')
          .eq('project_id', id),
        chatIds.length > 0
          ? supabase
              .from('documents' as any)
              .select('id, storage_path')
              .in('chat_id', chatIds)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      if (projectDocsError) throw projectDocsError;
      if (chatDocsError) throw chatDocsError;

      const combinedDocs = [
        ...((projectDocs ?? []) as unknown as Array<{ id: string; storage_path: string }>),
        ...((chatDocs ?? []) as unknown as Array<{ id: string; storage_path: string }>),
      ];

      const uniqueDocs = Array.from(new Map(combinedDocs.map((d) => [d.id, d])).values());
      const storagePaths = uniqueDocs
        .map((d) => d.storage_path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0);

      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('insight-navigator')
          .remove(storagePaths);
        if (storageError && !/not found/i.test(storageError.message || '')) {
          throw storageError;
        }
      }

      if (uniqueDocs.length > 0) {
        const docIds = uniqueDocs.map((d) => d.id);
        const { error: deleteDocsError } = await supabase
          .from('documents' as any)
          .delete()
          .in('id', docIds);
        if (deleteDocsError) throw deleteDocsError;
      }
      
      if (chatIds.length > 0) {
        await supabase.from('messages').delete().in('chat_id', chatIds);
        await supabase.from('chats').delete().eq('project_id', id);
      }

      const { error } = await supabase.from('projects').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['chats'] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['document-count'] });
    },
  });
}
