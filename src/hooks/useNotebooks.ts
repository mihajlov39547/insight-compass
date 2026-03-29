import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

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
      language: 'en' | 'sr-lat';
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
    mutationFn: async ({ id, ...updates }: Partial<DbNotebook> & { id: string }) => {
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
      // Remove notebook association from documents  
      await (supabase.from('documents') as any).update({ notebook_id: null }).eq('notebook_id', id);

      const { error } = await (supabase.from('notebooks' as any) as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notebooks'] }),
  });
}
