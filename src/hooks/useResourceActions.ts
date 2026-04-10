import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { startDocumentWorkflow } from '@/hooks/useDocuments';
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

export interface CreateSourceConnectionRequestInput {
  provider: string;
  displayName?: string;
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
      if (resource.storagePath) {
        const { error: storageError } = await supabase.storage
          .from('insight-navigator')
          .remove([resource.storagePath]);

        if (storageError && !/not found/i.test(storageError.message || '')) {
          throw storageError;
        }
      }

      const { error } = await supabase
        .from('documents' as any)
        .delete()
        .eq('id', resource.id);

      if (error) throw error;
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

      return Array.isArray(data) ? data[0] : data;
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

export function useCreateSourceConnectionRequest() {
  return useMutation({
    mutationFn: async (input: CreateSourceConnectionRequestInput) => {
      const { data, error } = await supabase.rpc('create_source_connection_request_stub' as any, {
        p_provider: input.provider,
        p_display_name: input.displayName?.trim() || null,
        p_metadata: { stub: true },
      });

      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
  });
}

export function useRetryYouTubeTranscriptIngestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (resource: ResourceActionInput) => {
      const { error } = await supabase.rpc('enqueue_youtube_transcript_job' as any, {
        p_resource_id: resource.id,
        p_force_retry: true,
      });

      if (error) throw error;

      return resource;
    },
    onSuccess: (resource) => {
      invalidateResourceScopes(queryClient, resource);
    },
  });
}
