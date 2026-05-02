import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { startDocumentWorkflow } from '@/hooks/useDocuments';
import { getFunctionUrl, SUPABASE_PUBLISHABLE_KEY } from '@/config/env';
import type { ContainerType, Resource } from '@/lib/resourceClassification';

export interface ResourceActionInput {
  id: string;
  title: string;
  storagePath: string;
  ownerUserId: string;
  containerType: ContainerType;
  containerId: string | null;
  processingStatus: string;
  resourceKind?: string;
}

export interface RenameResourceInput {
  resource: ResourceActionInput;
  newTitle: string;
}

export interface CreateLinkResourceInput {
  url: string;
  title?: string;
  provider: string;
  containerType: ContainerType;
  containerId: string | null;
}


interface RenameResourceResult {
  id: string;
  title: string;
  updatedAt: string;
}

function invalidateResourceScopes(
  queryClient: ReturnType<typeof useQueryClient>,
  resource: ResourceActionInput,
) {
  const projectId = resource.containerType === 'project' ? resource.containerId : null;
  const notebookId = resource.containerType === 'notebook' ? resource.containerId : null;

  queryClient.invalidateQueries({ queryKey: ['resources'] });
  queryClient.invalidateQueries({ queryKey: ['documents', projectId] });
  queryClient.invalidateQueries({ queryKey: ['document-count', projectId] });

  if (notebookId) {
    queryClient.invalidateQueries({ queryKey: ['notebook-documents', notebookId] });
    queryClient.invalidateQueries({ queryKey: ['notebook-document-counts'] });
  }
}

export function useDeleteResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (resource: ResourceActionInput) => {
      const isLinkedResource = resource.resourceKind === 'resource' || resource.resourceKind === 'link';

      if (isLinkedResource) {
        // Linked resources live in resource_links; FK cascades handle
        // youtube_transcript_jobs and link_transcript_chunks automatically.
        const { data, error, count } = await supabase
          .from('resource_links' as any)
          .delete()
          .eq('id', resource.id)
          .select('id');

        if (error) throw error;
        if (!data || (data as any[]).length === 0) {
          throw new Error('Delete had no effect — linked resource not found or not permitted.');
        }
      } else {
        // Document-backed resources: remove storage file first, then DB row.
        if (resource.storagePath) {
          const { error: storageError } = await supabase.storage
            .from('insight-navigator')
            .remove([resource.storagePath]);

          if (storageError && !/not found/i.test(storageError.message || '')) {
            throw storageError;
          }
        }

        const { data, error } = await supabase
          .from('documents' as any)
          .delete()
          .eq('id', resource.id)
          .select('id');

        if (error) throw error;
        if (!data || (data as any[]).length === 0) {
          throw new Error('Delete had no effect — document not found or not permitted.');
        }
      }

      return resource;
    },
    onSuccess: (resource) => {
      invalidateResourceScopes(queryClient, resource);
    },
  });
}

export function useRetryResourceProcessing() {
  const queryClient = useQueryClient();

  return useMutation({
    onMutate: async (resource: ResourceActionInput) => {
      await queryClient.cancelQueries({ queryKey: ['resources'] });

      const previousResources = queryClient.getQueriesData<Resource[]>({ queryKey: ['resources'] });
      const optimisticUpdatedAt = new Date().toISOString();

      for (const [queryKey, queryData] of previousResources) {
        if (!queryData) continue;
        queryClient.setQueryData<Resource[]>(queryKey, queryData.map((item) => (
          item.id === resource.id
            ? {
              ...item,
              processingStatus: 'queued',
              processingError: null,
              updatedAt: optimisticUpdatedAt,
            }
            : item
        )));
      }

      return { previousResources };
    },
    mutationFn: async (resource: ResourceActionInput) => {
      await startDocumentWorkflow(
        {
          id: resource.id,
          user_id: resource.ownerUserId,
          storage_path: resource.storagePath,
          processing_status: resource.processingStatus,
        },
        'retry',
      );
      return resource;
    },
    onError: (_error, _resource, context) => {
      for (const [queryKey, queryData] of context?.previousResources || []) {
        queryClient.setQueryData(queryKey, queryData);
      }
    },
    onSuccess: (resource) => {
      invalidateResourceScopes(queryClient, resource);
    },
  });
}

export async function downloadResourceFromStorage(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('insight-navigator')
    .createSignedUrl(storagePath, 60);

  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Unable to create download URL');
  return data.signedUrl;
}

export function useRenameResource() {
  const queryClient = useQueryClient();

  return useMutation<RenameResourceResult, Error, RenameResourceInput, { previousResources: Array<[readonly unknown[], Resource[] | undefined]> }>({
    mutationFn: async ({ resource, newTitle }) => {
      const normalizedTitle = newTitle.trim();
      const { data, error } = await supabase.rpc('rename_user_resource' as any, {
        p_resource_id: resource.id,
        p_new_title: normalizedTitle,
      });

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      return {
        id: resource.id,
        title: row?.title || normalizedTitle,
        updatedAt: row?.updated_at || new Date().toISOString(),
      };
    },
    onMutate: async ({ resource, newTitle }) => {
      await queryClient.cancelQueries({ queryKey: ['resources'] });
      const previousResources = queryClient.getQueriesData<Resource[]>({ queryKey: ['resources'] });
      const optimisticUpdatedAt = new Date().toISOString();

      for (const [queryKey, queryData] of previousResources) {
        if (!queryData) continue;
        queryClient.setQueryData<Resource[]>(queryKey, queryData.map((item) => (
          item.id === resource.id
            ? { ...item, title: newTitle.trim(), updatedAt: optimisticUpdatedAt }
            : item
        )));
      }

      return { previousResources };
    },
    onError: (_error, _variables, context) => {
      for (const [queryKey, queryData] of context?.previousResources || []) {
        queryClient.setQueryData(queryKey, queryData);
      }
    },
    onSuccess: (_result, variables) => {
      invalidateResourceScopes(queryClient, variables.resource);
    },
  });
}

async function maybeStartYoutubeWorkflow(resourceId: string, userId: string, url: string) {
  // Phase 5: Workflow is now the primary path. Legacy enqueue still runs in
  // the SQL stub as a safety net until Phase 6 decommission.
  try {

    const resp = await fetch(getFunctionUrl('/functions/v1/workflow-start'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({
        definition_key: 'youtube_processing_v1',
        input_payload: {
          resource_link_id: resourceId,
          source: 'create_link',
          url,
          initiated_at: new Date().toISOString(),
        },
        user_id: userId,
        trigger_entity_type: 'resource_link',
        trigger_entity_id: resourceId,
        idempotency_key: `youtube-workflow-${resourceId}`,
        create_initial_context_snapshot: true,
      }),
    });
    if (!resp.ok) {
      console.warn('[youtube workflow] workflow-start failed', resp.status, await resp.text().catch(() => ''));
    }
  } catch (err) {
    console.warn('[youtube workflow] flag check / start error', err);
  }
}

export function useCreateLinkResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateLinkResourceInput) => {
      const { data, error } = await supabase.rpc('create_link_resource_stub' as any, {
        p_url: input.url.trim(),
        p_title: input.title?.trim() || null,
        p_provider: input.provider,
        p_container_type: input.containerType,
        p_container_id: input.containerId,
      });

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;

      // Phase 5: Always kick the workflow path for YouTube links.
      // Legacy enqueue still runs inside the SQL stub as safety net.
      if (row?.id && input.provider === 'youtube') {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;
        if (userId) {
          await maybeStartYoutubeWorkflow(row.id, userId, input.url.trim());
        }
      }

      return row;
    },
    onSuccess: (_result, input) => {
      invalidateResourceScopes(queryClient, {
        id: '',
        title: input.title || input.url,
        storagePath: '',
        ownerUserId: '',
        containerType: input.containerType,
        containerId: input.containerId,
        processingStatus: 'completed',
      });
    },
  });
}


export function useRetryYouTubeTranscriptIngestion() {
  const queryClient = useQueryClient();

  return useMutation({
    onMutate: async (resource: ResourceActionInput) => {
      // Clear stale debug (often null) before a new transcript attempt starts.
      await queryClient.cancelQueries({ queryKey: ['resource-transcript-debug', resource.id] });
      queryClient.invalidateQueries({ queryKey: ['resource-transcript-debug', resource.id] });
      queryClient.invalidateQueries({ queryKey: ['resource-workflow-timeline', resource.id] });
    },
    mutationFn: async (resource: ResourceActionInput) => {
      // Phase 5: Workflow-first retry. Always attempt the workflow path;
      // fall back to legacy enqueue only if the workflow call itself errors.
      try {
        const { data: link } = await supabase
          .from('resource_links')
          .select('url')
          .eq('id', resource.id)
          .maybeSingle();

        if (link?.url) {
          const resp = await fetch(getFunctionUrl('/functions/v1/workflow-start'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({
              definition_key: 'youtube_processing_v1',
              input_payload: {
                resource_link_id: resource.id,
                source: 'retry',
                url: link.url,
                initiated_at: new Date().toISOString(),
              },
              user_id: resource.ownerUserId,
              trigger_entity_type: 'resource_link',
              trigger_entity_id: resource.id,
              idempotency_key: `youtube-workflow-retry-${resource.id}-${Date.now()}`,
              create_initial_context_snapshot: true,
            }),
          });
          if (!resp.ok) {
            throw new Error(`Workflow retry failed: ${resp.status}`);
          }
          return resource;
        }
      } catch (err: any) {
        console.error('[youtube retry] workflow retry failed', err);
        throw err;
      }
    },
    onSuccess: (resource) => {
      invalidateResourceScopes(queryClient, resource);
      queryClient.invalidateQueries({ queryKey: ['resource-transcript-debug', resource.id] });
      queryClient.invalidateQueries({ queryKey: ['resource-workflow-timeline', resource.id] });
    },
  });
}
