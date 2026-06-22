import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getFunctionUrl, SUPABASE_PUBLISHABLE_KEY } from '@/config/env';

export interface IngestWebsiteCrawlInput {
  url: string;
  instructions?: string;
  includeImages?: boolean;
  containerType: 'project' | 'notebook';
  containerId: string;
}

export interface IngestWebsiteCrawlResult {
  documentId: string;
  title: string;
  provider: string;
  pages: number;
  tier: string;
  status: string;
}

export function useIngestWebsiteCrawl() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: IngestWebsiteCrawlInput): Promise<IngestWebsiteCrawlResult> => {
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session?.session?.access_token;
      const resp = await fetch(getFunctionUrl('/functions/v1/website-crawl-ingest'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: accessToken ? `Bearer ${accessToken}` : `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify(input),
      });
      let payload: any = null;
      try { payload = await resp.json(); } catch { /* ignore */ }
      if (!resp.ok) {
        const err = new Error(payload?.message || `website-crawl-ingest failed (${resp.status})`);
        (err as any).code = payload?.error;
        (err as any).status = resp.status;
        throw err;
      }
      return payload as IngestWebsiteCrawlResult;
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
