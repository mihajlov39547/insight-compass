import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export interface DbDocument {
  id: string;
  user_id: string;
  project_id: string | null;
  chat_id: string | null;
  notebook_id: string | null;
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
  'chunking', 'generating_embeddings', 'generating_chunk_questions',
  'pending', 'queued', 'claimed', 'running', 'waiting_retry',
]);

const ACTIVE_WORKFLOW_STATES = new Set(['pending', 'running']);

function isWorkflowCutoverEnabled(): boolean {
  // Requested Phase F control semantics:
  // - default/unset => cutover enabled
  // - VITE_DOCUMENT_WORKFLOW_CUTOVER_DISABLED=true => cutover disabled
  return String(import.meta.env.VITE_DOCUMENT_WORKFLOW_CUTOVER_DISABLED || '').toLowerCase() !== 'true';
}

function getSupabaseFunctionHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
  };
}

async function triggerProcessDocument(documentId: string): Promise<void> {
  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-document`,
    {
      method: 'POST',
      headers: getSupabaseFunctionHeaders(),
      body: JSON.stringify({ documentId }),
    }
  );

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Processing failed' }));
    throw new Error(err.error || 'Processing failed');
  }
}

async function startDocumentWorkflowOrFallback(doc: DbDocument, mode: 'upload' | 'retry'): Promise<{
  path: 'workflow' | 'workflow_existing' | 'fallback_process_document';
  workflowRunId?: string;
}> {
  const fallbackToProcessDocument = async (): Promise<{
    path: 'fallback_process_document';
  }> => {
    await triggerProcessDocument(doc.id);
    return { path: 'fallback_process_document' };
  };

  if (!isWorkflowCutoverEnabled()) {
    return fallbackToProcessDocument();
  }

  if (doc.processing_status === 'completed') {
    return { path: 'workflow_existing' };
  }

  // Avoid duplicate active runs for the same document during cutover.
  const { data: existingRuns, error: existingRunError } = await supabase
    .from('workflow_runs' as any)
    .select('id, status')
    .eq('trigger_entity_type', 'document')
    .eq('trigger_entity_id', doc.id)
    .in('status', Array.from(ACTIVE_WORKFLOW_STATES))
    .order('created_at', { ascending: false })
    .limit(1);

  const existingRunRows = Array.isArray(existingRuns) ? (existingRuns as Array<{ id?: string }>) : [];

  if (!existingRunError && existingRunRows.length > 0) {
    return {
      path: 'workflow_existing',
      workflowRunId: existingRunRows[0].id,
    };
  }

  const requestPayload = {
    definition_key: 'document_processing_v1',
    input_payload: {
      document_id: doc.id,
      source: mode === 'upload' ? 'upload_cutover' : 'retry_cutover',
      source_document_id: doc.id,
      source_storage_path: doc.storage_path,
      cutover_mode: true,
      initiated_at: new Date().toISOString(),
    },
    user_id: doc.user_id,
    trigger_entity_type: 'document',
    trigger_entity_id: doc.id,
    idempotency_key: mode === 'upload' ? `upload-workflow-${doc.id}` : null,
    create_initial_context_snapshot: true,
  };

  const workflowResp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/workflow-start`,
    {
      method: 'POST',
      headers: getSupabaseFunctionHeaders(),
      body: JSON.stringify(requestPayload),
    }
  );

  if (workflowResp.ok) {
    const workflowData = await workflowResp.json().catch(() => ({}));
    return {
      path: 'workflow',
      workflowRunId: workflowData?.workflow_run_id,
    };
  }

  // Safer MVP: immediate rollback fallback to monolithic path on workflow start failure.
  return fallbackToProcessDocument();
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

      // Trigger processing for each uploaded document.
      // Phase F cutover: workflow-start primary (when enabled), process-document fallback.
      for (const doc of results) {
        startDocumentWorkflowOrFallback(doc, 'upload').catch(() => {
          /* processing failure is tracked server-side */
        });
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
      const trigger = await startDocumentWorkflowOrFallback(doc, 'retry');
      return {
        status: 'accepted',
        ...trigger,
      };
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
      if (doc.notebook_id) {
        queryClient.invalidateQueries({ queryKey: ['notebook-documents', doc.notebook_id] });
        queryClient.invalidateQueries({ queryKey: ['notebook-document-counts'] });
      }
    },
  });
}
