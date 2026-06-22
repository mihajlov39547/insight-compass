import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';
import { getFunctionUrl, SUPABASE_PUBLISHABLE_KEY } from '@/config/env';

export interface GoogleDoc {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  ownerName: string | null;
  ownerEmail: string | null;
  webViewLink: string | null;
  iconLink: string | null;
  canDownload: boolean;
  supported: boolean;
}

async function callGdocsFunction<T>(path: string, body: unknown): Promise<T> {
  const { data: session } = await supabase.auth.getSession();
  const accessToken = session?.session?.access_token;
  const resp = await fetch(getFunctionUrl(`/functions/v1/${path}`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: accessToken
        ? `Bearer ${accessToken}`
        : `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify(body || {}),
  });
  let payload: any = null;
  try { payload = await resp.json(); } catch { /* ignore */ }
  if (!resp.ok) {
    const err = new Error(payload?.message || `${path} failed (${resp.status})`);
    (err as any).code = payload?.error;
    (err as any).status = resp.status;
    throw err;
  }
  return payload as T;
}

export function useGoogleDocsSearch(params: { query: string; enabled: boolean }) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['gdocs-search', params.query],
    enabled: !!user && params.enabled,
    queryFn: async () => {
      const data = await callGdocsFunction<{ files: GoogleDoc[] }>('gdocs-search', {
        query: params.query,
      });
      return data.files || [];
    },
    staleTime: 15_000,
    retry: false,
  });
}

export interface IngestGoogleDocInput {
  fileId: string;
  containerType: 'project' | 'notebook';
  containerId: string;
}

export function useIngestGoogleDoc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: IngestGoogleDocInput) => {
      return callGdocsFunction<{ documentId: string; title: string; status: string; provider: string }>(
        'gdocs-ingest',
        input,
      );
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
