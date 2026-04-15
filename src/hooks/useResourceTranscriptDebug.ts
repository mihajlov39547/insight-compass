import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface StageDebugEntry {
  stage: string;
  pageVariant?: string;
  status: 'skipped' | 'failed' | 'success';
  reason?: string;
  trackCount?: number;
  chosenLang?: string;
  chosenKind?: string;
  httpStatus?: number;
  innertubeKey?: string | null;
  innertubeKeySource?: string;
}

export interface TranscriptDebugPayload {
  stages: StageDebugEntry[];
  winningStrategy: string | null;
  pageVariantsAttempted: string[];
  pageExtractedInnertubeKey: string | null;
  envInnertubeKeyPresent: boolean;
  serpapiAttempted?: boolean;
  serpapiSearchId?: string | null;
  serpapiLanguageCode?: string | null;
  serpapiError?: string | null;
  totalDurationMs: number;
}

export function useResourceTranscriptDebug(resourceId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['resource-transcript-debug', resourceId],
    enabled: enabled && !!resourceId,
    queryFn: async (): Promise<TranscriptDebugPayload | null> => {
      if (!resourceId) return null;

      const { data, error } = await supabase
        .from('resource_links')
        .select('metadata')
        .eq('id', resourceId)
        .maybeSingle();

      if (error || !data) return null;

      const meta = data.metadata as Record<string, any> | null;
      return (meta?.transcript?.debug as TranscriptDebugPayload) || null;
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: enabled && !!resourceId ? 5000 : false,
    refetchIntervalInBackground: false,
  });
}
