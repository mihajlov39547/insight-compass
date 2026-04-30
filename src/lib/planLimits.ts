import type { Plan } from '@/types/app';

export interface PlanLimits {
  maxProjects: number | null;
  maxNotebooks: number | null;
  maxDocumentsPerProject: number | null;
  maxDocumentsPerNotebook: number | null;
  maxChatsPerProject: number | null;
  canShareProjects: boolean;
  canShareNotebooks: boolean;
  maxShareMembers: number | null;
  restrictedModelIds: string[];
}

const UNLIMITED: PlanLimits = {
  maxProjects: null,
  maxNotebooks: null,
  maxDocumentsPerProject: null,
  maxDocumentsPerNotebook: null,
  maxChatsPerProject: null,
  canShareProjects: true,
  canShareNotebooks: true,
  maxShareMembers: null,
  restrictedModelIds: [],
};

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    maxProjects: 3,
    maxNotebooks: 3,
    maxDocumentsPerProject: 5,
    maxDocumentsPerNotebook: 5,
    maxChatsPerProject: 1,
    canShareProjects: false,
    canShareNotebooks: false,
    maxShareMembers: 0,
    restrictedModelIds: ['openai/gpt-5', 'openai/gpt-5.2'],
  },
  basic: {
    maxProjects: 10,
    maxNotebooks: 10,
    maxDocumentsPerProject: 10,
    maxDocumentsPerNotebook: 10,
    maxChatsPerProject: 5,
    canShareProjects: true,
    canShareNotebooks: false,
    maxShareMembers: 3,
    restrictedModelIds: ['openai/gpt-5', 'openai/gpt-5.2'],
  },
  premium: {
    maxProjects: null,
    maxNotebooks: null,
    maxDocumentsPerProject: 500,
    maxDocumentsPerNotebook: 500,
    maxChatsPerProject: null,
    canShareProjects: true,
    canShareNotebooks: true,
    maxShareMembers: null,
    restrictedModelIds: [],
  },
  enterprise: UNLIMITED,
};

export function getPlanLimits(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan] ?? UNLIMITED;
}

export function isModelRestricted(plan: Plan, modelId: string): boolean {
  return getPlanLimits(plan).restrictedModelIds.includes(modelId);
}
