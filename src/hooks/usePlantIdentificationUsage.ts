import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';
import { normalizePlan } from '@/types/app';
import {
  currentMonthKey,
  getPlantAiScanMonthlyLimit,
  type PlantAiScanPlan,
} from '@/config/plantIdentificationLimits';

// Shared monthly counter for plant identification AND disease diagnosis.
// Reads from the existing `plant_identification_usage` table (kept for
// back-compat); every successful identify OR diagnose call increments the
// same row via `increment_plant_identification_usage`.
export interface PlantAiScanUsage {
  used: number;
  limit: number;
  remaining: number;
  isLimitReached: boolean;
  plan: PlantAiScanPlan;
  monthKey: string;
  loading: boolean;
}

export function usePlantAiScanUsage(): PlantAiScanUsage {
  const { user, profile } = useAuth();
  const plan = normalizePlan(profile?.plan) as PlantAiScanPlan;
  const limit = getPlantAiScanMonthlyLimit(plan);
  const monthKey = currentMonthKey();

  const q = useQuery({
    enabled: !!user,
    queryKey: ['plant_ai_scan_usage', user?.id, monthKey],
    queryFn: async (): Promise<number> => {
      const { data, error } = await (supabase as any)
        .from('plant_identification_usage')
        .select('request_count')
        .eq('user_id', user!.id)
        .eq('provider', 'plantnet')
        .eq('month_key', monthKey)
        .maybeSingle();
      if (error) throw error;
      return (data?.request_count as number | undefined) ?? 0;
    },
  });

  const used = q.data ?? 0;
  const remaining = Math.max(0, limit - used);
  return {
    used,
    limit,
    remaining,
    isLimitReached: used >= limit,
    plan,
    monthKey,
    loading: q.isLoading,
  };
}

// Back-compat alias.
export const usePlantIdentificationUsage = usePlantAiScanUsage;
export type PlantIdentificationUsage = PlantAiScanUsage;
