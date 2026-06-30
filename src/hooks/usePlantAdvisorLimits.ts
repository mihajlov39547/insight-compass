import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';
import { normalizePlan } from '@/types/app';
import {
  getPlantAdvisorLimits,
  type PlantAdvisorLimits,
  type PlantAdvisorPlan,
} from '@/config/plantAdvisorLimits';

export interface PlantAdvisorUsage {
  plan: PlantAdvisorPlan;
  limits: PlantAdvisorLimits;
  caseCount: number;
  totalImages: number;
  driveConfigured: boolean | null; // null = unknown
  loading: boolean;
}

export function usePlantAdvisorUsage(): PlantAdvisorUsage {
  const { user, profile } = useAuth();
  const plan = normalizePlan(profile?.plan) as PlantAdvisorPlan;
  const limits = getPlantAdvisorLimits(plan);

  const caseCountQ = useQuery({
    enabled: !!user,
    queryKey: ['plant_cases_count', user?.id],
    queryFn: async () => {
      const { count, error } = await (supabase as any)
        .from('plant_cases')
        .select('id', { count: 'exact', head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const imageCountQ = useQuery({
    enabled: !!user,
    queryKey: ['plant_images_count', user?.id],
    queryFn: async () => {
      const { count, error } = await (supabase as any)
        .from('plant_case_images')
        .select('id', { count: 'exact', head: true })
        .neq('upload_status', 'deleted');
      if (error) throw error;
      return count ?? 0;
    },
  });

  const driveQ = useQuery({
    enabled: !!user,
    queryKey: ['plant_drive_configured'],
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.functions.invoke('plant-drive-storage-diagnostic', {
          body: {},
        });
        if (error) return false;
        return !!(data as any)?.configured;
      } catch {
        return false;
      }
    },
  });

  return {
    plan,
    limits,
    caseCount: caseCountQ.data ?? 0,
    totalImages: imageCountQ.data ?? 0,
    driveConfigured: driveQ.data ?? null,
    loading: caseCountQ.isLoading || imageCountQ.isLoading,
  };
}
