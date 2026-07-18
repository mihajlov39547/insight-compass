import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export type PlantAiScanEventStatus =
  | 'reserved'
  | 'provider_success'
  | 'provider_error'
  | 'empty_results';

export type PlantAiScanType = 'identify' | 'diagnose';

export interface PlantAiScanEvent {
  id: string;
  user_id: string;
  case_id: string | null;
  provider: string;
  scan_type: PlantAiScanType;
  month_key: string;
  status: PlantAiScanEventStatus;
  usage_used: number | null;
  usage_limit: number | null;
  usage_remaining: number | null;
  provider_status: number | null;
  error_code: string | null;
  created_at: string;
}

interface Options {
  limit?: number;
  caseId?: string | null;
  monthKey?: string | null;
}

export function usePlantAiScanEvents(options: Options = {}) {
  const { user } = useAuth();
  const limit = options.limit ?? 50;
  return useQuery({
    enabled: !!user,
    queryKey: ['plant_ai_scan_events', user?.id, options.caseId ?? null, options.monthKey ?? null, limit],
    queryFn: async (): Promise<PlantAiScanEvent[]> => {
      let q = (supabase as any)
        .from('plant_ai_scan_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (options.caseId) q = q.eq('case_id', options.caseId);
      if (options.monthKey) q = q.eq('month_key', options.monthKey);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PlantAiScanEvent[];
    },
  });
}
