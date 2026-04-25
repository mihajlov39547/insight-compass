import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';
import type { AvailableLanguageCode } from '@/lib/languages';

export interface DbNotebook {
  id: string;
  user_id: string;
  name: string;
  description: string;
  icon: string | null;
  color: string | null;
  language: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export function useNotebooks() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['notebooks', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notebooks' as any)
        .select('*')
        .eq('is_archived', false)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DbNotebook[];
    },
    enabled: !!user,
  });
}

export function useCreateNotebook() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      name,
      description,
      language,
      icon,
      color,
    }: {
      name: string;
      description: string;
      language: AvailableLanguageCode;
      icon?: string;
      color?: string;
    }) => {
      const { data, error } = await supabase
        .from('notebooks' as any)
        .insert({ user_id: user!.id, name, description, language, icon: icon || null, color: color || null })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as DbNotebook;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notebooks'] }),
  });
}

export function useUpdateNotebook() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Omit<DbNotebook, 'id' | 'user_id' | 'language' | 'created_at' | 'updated_at'>> & { id: string }) => {
      const { data, error } = await supabase
        .from('notebooks' as any)
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as DbNotebook;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notebooks'] }),
  });
}

export function useArchiveNotebook() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notebooks' as any)
        .update({ is_archived: true })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notebooks'] }),
  });
}

export function useDeleteNotebook() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // Gather storage paths for documents attached to this notebook
      const { data: notebookDocs, error: docsError } = await (supabase.from('documents') as any)
        .select('id, storage_path')
        .eq('notebook_id', id);
      if (docsError) throw docsError;

      const docs = (notebookDocs ?? []) as Array<{ id: string; storage_path: string }>;
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

      // Delete notebook — cascades to: documents → analysis/chunks/chunk_questions,
      // notebook_messages, notebook_notes, resource_links, link_transcript_chunks, shares (via trigger)
      const { error } = await (supabase.from('notebooks' as any) as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notebooks'] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['notebook-documents'] });
      qc.invalidateQueries({ queryKey: ['notebook-document-counts'] });
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['shares'] });
    },
  });
}
