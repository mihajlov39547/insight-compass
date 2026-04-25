export const PLAN_IDS = ['free', 'basic', 'premium', 'enterprise'] as const;

export type Plan = typeof PLAN_IDS[number];

export interface AppUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  initials: string;
  plan: Plan;
}

export const DEFAULT_APP_USER: AppUser = {
  id: 'user-1',
  name: '',
  email: '',
  initials: '',
  plan: 'free',
};

export function isPlan(value: unknown): value is Plan {
  return typeof value === 'string' && PLAN_IDS.includes(value as Plan);
}

export function normalizePlan(value: unknown): Plan {
  return isPlan(value) ? value : 'free';
}
