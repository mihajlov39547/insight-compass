import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size: number | null;
  owner: string | null;
  webViewLink: string | null;
  iconLink: string | null;
  parents: string[];
  supported: boolean;
}

export type DriveMimeFilter = 'all' | 'docs' | 'pdf' | 'text';

export const SUPPORTED_DRIVE_MIME_LABELS: Record<string, string> = {
  'application/vnd.google-apps.document': 'Google Doc',
  'application/pdf': 'PDF',
  'text/plain': 'Text',
  'text/markdown': 'Markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.google-apps.spreadsheet': 'Google Sheet',
  'application/vnd.google-apps.presentation': 'Google Slides',
  'application/vnd.google-apps.folder': 'Folder',
};

export function useGoogleDriveSearch(params: {
  query: string;
  mimeFilter: DriveMimeFilter;
  enabled: boolean;
}) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['gdrive-search', params.query, params.mimeFilter],
    enabled: !!user && params.enabled,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('gdrive-search', {
        body: { query: params.query, mimeFilter: params.mimeFilter },
      });
      if (error) {
        // Surface server-provided friendly error if available.
        const ctxBody: any = (error as any).context?.body;
        let parsed: any = null;
        try { parsed = ctxBody ? JSON.parse(ctxBody) : null; } catch { /* ignore */ }
        const err = new Error(parsed?.message || error.message || 'Drive search failed');
        (err as any).code = parsed?.error;
        throw err;
      }
      return (data?.files || []) as DriveFile[];
    },
    staleTime: 15_000,
  });
}

export interface IngestDriveFileInput {
  fileId: string;
  containerType: 'project' | 'notebook';
  containerId: string;
}

export function useIngestGoogleDriveFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: IngestDriveFileInput) => {
      const { data, error } = await supabase.functions.invoke('gdrive-ingest', {
        body: input,
      });
      if (error) {
        const ctxBody: any = (error as any).context?.body;
        let parsed: any = null;
        try { parsed = ctxBody ? JSON.parse(ctxBody) : null; } catch { /* ignore */ }
        const err = new Error(parsed?.message || error.message || 'Drive ingest failed');
        (err as any).code = parsed?.error;
        throw err;
      }
      return data as { documentId: string; title: string; status: string };
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ['resources'] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      if (input.containerType === 'notebook') {
        queryClient.invalidateQueries({ queryKey: ['notebook-documents', input.containerId] });
        queryClient.invalidateQueries({ queryKey: ['notebook-document-counts'] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['document-count', input.containerId] });
      }
    },
  });
}
