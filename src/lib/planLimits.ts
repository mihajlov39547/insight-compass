import type { Plan } from '@/types/app';

export interface PlanLimits {
  maxProjects: number | null;
  maxNotebooks: number | null;
  maxDocumentsPerProject: number | null;
  maxDocumentsPerNotebook: number | null;
  canShare: boolean;
  restrictedModelIds: string[];
}

const UNLIMITED: PlanLimits = {
  maxProjects: null,
  maxNotebooks: null,
  maxDocumentsPerProject: null,
  maxDocumentsPerNotebook: null,
  canShare: true,
  restrictedModelIds: [],
};

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    maxProjects: 3,
    maxNotebooks: 3,
    maxDocumentsPerProject: 5,
    maxDocumentsPerNotebook: 5,
    canShare: false,
    restrictedModelIds: ['openai/gpt-5', 'openai/gpt-5.2'],
  },
  basic: UNLIMITED,
  premium: UNLIMITED,
  enterprise: UNLIMITED,
};

export function getPlanLimits(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan] ?? UNLIMITED;
}

export function isModelRestricted(plan: Plan, modelId: string): boolean {
  return getPlanLimits(plan).restrictedModelIds.includes(modelId);
}
