import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface DbDocument {
  id: string;
  user_id: string;
  project_id: string;
  chat_id: string | null;
  file_name: string;
  file_type: string;
  mime_type: string;
  file_size: number;
  storage_path: string;
  created_at: string;
  processing_status: string;
  processing_error: string | null;
  detected_language: string | null;
  summary: string | null;
  page_count: number | null;
  word_count: number | null;
  char_count: number | null;
}

export function useDocuments(projectId?: string, chatId?: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['documents', projectId, chatId],
    queryFn: async () => {
      if (!projectId) return [];
      let query = supabase
        .from('documents' as any)
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (chatId) {
        query = query.eq('chat_id', chatId);
      } else if (chatId === null) {
        query = query.is('chat_id', null);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as DbDocument[];
    },
    enabled: !!user && !!projectId,
  });
}

export function useProjectDocumentCount(projectId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['document-count', projectId],
    queryFn: async () => {
      if (!projectId) return 0;
      const { count, error } = await supabase
        .from('documents' as any)
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!user && !!projectId,
  });
}

const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'txt', 'rtf', 'csv', 'xls', 'xlsx', 'md',
]);

const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bin', 'dll', 'msi', 'app', 'bat', 'cmd', 'com', 'scr',
]);

export function isFileAllowed(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (BLOCKED_EXTENSIONS.has(ext)) return false;
  return ALLOWED_EXTENSIONS.has(ext);
}

interface UploadParams {
  files: File[];
  projectId: string;
  chatId?: string | null;
}

export function useUploadDocuments() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ files, projectId, chatId }: UploadParams) => {
      if (!user) throw new Error('Not authenticated');

      const results: DbDocument[] = [];
      const errors: string[] = [];

      for (const file of files) {
        if (!isFileAllowed(file.name)) {
          errors.push(`${file.name}: unsupported file type`);
          continue;
        }

        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const storagePath = `${user.id}/${projectId}/${crypto.randomUUID()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('insight-navigator')
          .upload(storagePath, file);

        if (uploadError) {
          errors.push(`${file.name}: ${uploadError.message}`);
          continue;
        }

        const { data, error: dbError } = await supabase
          .from('documents' as any)
          .insert({
            user_id: user.id,
            project_id: projectId,
            chat_id: chatId || null,
            file_name: file.name,
            file_type: ext,
            mime_type: file.type || 'application/octet-stream',
            file_size: file.size,
            storage_path: storagePath,
            processing_status: 'uploaded',
          })
          .select()
          .single();

        if (dbError) {
          errors.push(`${file.name}: ${dbError.message}`);
          continue;
        }

        results.push(data as unknown as DbDocument);
      }

      if (errors.length > 0 && results.length === 0) {
        throw new Error(errors.join('\n'));
      }

      return { uploaded: results, errors };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['documents', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['document-count', variables.projectId] });
    },
  });
}

export function useProcessDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (doc: DbDocument) => {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-document`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ documentId: doc.id }),
        }
      );

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Processing failed' }));
        throw new Error(err.error || 'Processing failed');
      }

      return resp.json();
    },
    onSuccess: (_, doc) => {
      queryClient.invalidateQueries({ queryKey: ['documents', doc.project_id] });
      queryClient.invalidateQueries({ queryKey: ['document-count', doc.project_id] });
    },
  });
}

export function useRetryProcessing() {
  const processMutation = useProcessDocument();

  return {
    retry: (doc: DbDocument) => processMutation.mutate(doc),
    isPending: processMutation.isPending,
  };
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (doc: DbDocument) => {
      await supabase.storage
        .from('insight-navigator')
        .remove([doc.storage_path]);

      const { error } = await supabase
        .from('documents' as any)
        .delete()
        .eq('id', doc.id);

      if (error) throw error;
      return doc;
    },
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: ['documents', doc.project_id] });
      queryClient.invalidateQueries({ queryKey: ['document-count', doc.project_id] });
    },
  });
}
