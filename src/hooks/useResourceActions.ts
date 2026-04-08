import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { startDocumentWorkflow } from '@/hooks/useDocuments';
import type { ContainerType } from '@/lib/resourceClassification';

export interface ResourceActionInput {
  id: string;
  title: string;
  storagePath: string;
  ownerUserId: string;
  containerType: ContainerType;
  containerId: string | null;
  processingStatus: string;
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
