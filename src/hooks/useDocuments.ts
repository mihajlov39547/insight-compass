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

async function markDocumentTriggerFailed(documentId: string, message: string): Promise<void> {
  const safeMessage = message.slice(0, 500);
  const { error } = await supabase
    .from('documents' as any)
    .update({
      processing_status: 'failed',
      processing_error: `Document trigger failed: ${safeMessage}`,
    })
    .eq('id', documentId)
    .neq('processing_status', 'completed');

  if (error) {
    console.warn('[doc-trigger] failed to persist trigger failure state', {
      document_id: documentId,
      error: error.message,
    });
  }
}

async function startDocumentWorkflow(doc: DbDocument, mode: 'upload' | 'retry'): Promise<{
  path: 'workflow' | 'workflow_existing';
  workflowRunId?: string;
}> {
  if (doc.processing_status === 'completed') {
    return { path: 'workflow_existing' };
  }

  // Avoid duplicate active runs for the same document.
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
    console.info('[doc-trigger] workflow path reused existing active run', {
      document_id: doc.id,
      mode,
      workflow_run_id: existingRunRows[0].id,
    });
    return {
      path: 'workflow_existing',
      workflowRunId: existingRunRows[0].id,
    };
  }

  const requestPayload = {
    definition_key: 'document_processing_v1',
    input_payload: {
      document_id: doc.id,
      source: mode === 'upload' ? 'upload' : 'retry',
      source_document_id: doc.id,
      source_storage_path: doc.storage_path,
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify(requestPayload),
    }
  );

  if (!workflowResp.ok) {
    const workflowErr = await workflowResp
      .json()
      .catch(() => ({ error: `workflow-start failed with status ${workflowResp.status}` }));
    throw new Error(workflowErr?.error || `workflow-start failed (${workflowResp.status})`);
  }

  const workflowData = await workflowResp.json().catch(() => ({}));
  console.info('[doc-trigger] workflow started', {
    document_id: doc.id,
    mode,
    workflow_run_id: workflowData?.workflow_run_id,
  });
  return {
    path: 'workflow',
    workflowRunId: workflowData?.workflow_run_id,
  };
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

      // Start workflow processing for each uploaded document.
      for (const doc of results) {
        startDocumentWorkflow(doc, 'upload').catch(async (err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[doc-trigger] upload workflow trigger failed', {
            document_id: doc.id,
            error: message,
          });
          await markDocumentTriggerFailed(doc.id, message);
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
      const trigger = await startDocumentWorkflow(doc, 'retry');
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
