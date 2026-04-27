import { useAuth } from '@/contexts/useAuth';
import { normalizePlan } from '@/types/app';
import { getPlanLimits, isModelRestricted, type PlanLimits } from '@/lib/planLimits';
import type { Plan } from '@/types/app';

export interface UsePlanLimitsResult {
  plan: Plan;
  limits: PlanLimits;
  isModelRestricted: (modelId: string) => boolean;
}

export function usePlanLimits(): UsePlanLimitsResult {
  const { profile } = useAuth();
  const plan = normalizePlan(profile?.plan);
  const limits = getPlanLimits(plan);
  return {
    plan,
    limits,
    isModelRestricted: (modelId: string) => isModelRestricted(plan, modelId),
  };
}
