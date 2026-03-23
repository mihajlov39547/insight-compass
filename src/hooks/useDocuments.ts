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
  retry_count: number;
  last_retry_at: string | null;
}

const PROCESSING_STATES = new Set([
  'uploaded', 'extracting_metadata', 'extracting_content',
  'detecting_language', 'summarizing', 'indexing',
]);

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
    // Poll every 4s while any document is still processing
    refetchInterval: (query) => {
      const docs = query.state.data as DbDocument[] | undefined;
      if (docs?.some(d => PROCESSING_STATES.has(d.processing_status))) return 4000;
      return false;
    },
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
  notebookId?: string | null;
}

export function useUploadDocuments() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ files, projectId, chatId, notebookId }: UploadParams) => {
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
            project_id: notebookId ? null : projectId,
            chat_id: chatId || null,
            notebook_id: notebookId || null,
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

      // Fire-and-forget: trigger processing for each uploaded doc
      for (const doc of results) {
        fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-document`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({ documentId: doc.id }),
          }
        ).catch(() => { /* processing failure is tracked server-side */ });
      }

      return { uploaded: results, errors };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['documents', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['document-count', variables.projectId] });
      if (variables.notebookId) {
        queryClient.invalidateQueries({ queryKey: ['notebook-documents', variables.notebookId] });
        queryClient.invalidateQueries({ queryKey: ['notebook-document-counts'] });
      }
    },
  });
}

export function useRetryProcessing() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
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
    },
  });

  return {
    retry: (doc: DbDocument) => mutation.mutate(doc),
    isPending: mutation.isPending,
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
      if ((doc as any).notebook_id) {
        queryClient.invalidateQueries({ queryKey: ['notebook-documents', (doc as any).notebook_id] });
        queryClient.invalidateQueries({ queryKey: ['notebook-document-counts'] });
      }
    },
  });
}
