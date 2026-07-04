import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';
import { normalizePlan } from '@/types/app';
import {
  currentMonthKey,
  getPlantIdentificationMonthlyLimit,
  type PlantIdentificationPlan,
} from '@/config/plantIdentificationLimits';

export interface PlantIdentificationUsage {
  used: number;
  limit: number;
  remaining: number;
  isLimitReached: boolean;
  monthKey: string;
  loading: boolean;
}

export function usePlantIdentificationUsage(): PlantIdentificationUsage {
  const { user, profile } = useAuth();
  const plan = normalizePlan(profile?.plan) as PlantIdentificationPlan;
  const limit = getPlantIdentificationMonthlyLimit(plan);
  const monthKey = currentMonthKey();

  const q = useQuery({
    enabled: !!user,
    queryKey: ['plant_identification_usage', user?.id, monthKey],
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
    monthKey,
    loading: q.isLoading,
  };
}
