import type { Plan } from '@/types/app';

export interface PlanLimits {
  maxProjects: number | null;
  maxNotebooks: number | null;
  maxDocumentsPerProject: number | null;
  maxDocumentsPerNotebook: number | null;
  canShare: boolean;
  maxShareMembers: number | null;
  restrictedModelIds: string[];
}

const UNLIMITED: PlanLimits = {
  maxProjects: null,
  maxNotebooks: null,
  maxDocumentsPerProject: null,
  maxDocumentsPerNotebook: null,
  canShare: true,
  maxShareMembers: null,
  restrictedModelIds: [],
};

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    maxProjects: 3,
    maxNotebooks: 3,
    maxDocumentsPerProject: 5,
    maxDocumentsPerNotebook: 5,
    canShare: false,
    maxShareMembers: 0,
    restrictedModelIds: ['openai/gpt-5', 'openai/gpt-5.2'],
  },
  basic: {
    maxProjects: 10,
    maxNotebooks: 10,
    maxDocumentsPerProject: 10,
    maxDocumentsPerNotebook: 10,
    canShare: true,
    maxShareMembers: 3,
    restrictedModelIds: ['openai/gpt-5', 'openai/gpt-5.2'],
  },
  premium: UNLIMITED,
  enterprise: UNLIMITED,
};

export function getPlanLimits(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan] ?? UNLIMITED;
}

export function isModelRestricted(plan: Plan, modelId: string): boolean {
  return getPlanLimits(plan).restrictedModelIds.includes(modelId);
}
