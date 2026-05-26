import type { Plan } from '@/types/app';

export interface WebCrawlLimits {
  limit: number;
  maxDepth: number;
  maxBreadth: number;
  extractDepth: 'basic' | 'advanced';
}

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
  webCrawl: WebCrawlLimits;
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
  webCrawl: { limit: 100, maxDepth: 3, maxBreadth: 30, extractDepth: 'advanced' },
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
    restrictedModelIds: ['openai/gpt-5', 'openai/gpt-5.2', 'gemma-4', 'gemini-3.1', 'google/gemini-3.5-flash'],
    webCrawl: { limit: 10, maxDepth: 1, maxBreadth: 10, extractDepth: 'basic' },
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
    restrictedModelIds: ['openai/gpt-5', 'openai/gpt-5.2', 'gemma-4'],
    webCrawl: { limit: 25, maxDepth: 2, maxBreadth: 20, extractDepth: 'basic' },
  },
  premium: {
    maxProjects: null,
    maxNotebooks: null,
    maxDocumentsPerProject: 50,
    maxDocumentsPerNotebook: 50,
    maxChatsPerProject: null,
    canShareProjects: true,
    canShareNotebooks: true,
    maxShareMembers: null,
    restrictedModelIds: [],
    webCrawl: { limit: 50, maxDepth: 2, maxBreadth: 25, extractDepth: 'advanced' },
  },
  enterprise: UNLIMITED,
};

export function getPlanLimits(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan] ?? UNLIMITED;
}

export function isModelRestricted(plan: Plan, modelId: string): boolean {
  return getPlanLimits(plan).restrictedModelIds.includes(modelId);
}
