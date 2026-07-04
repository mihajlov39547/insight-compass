// Plant identification monthly limits per plan.
// Backend must remain authoritative; the edge function mirrors these values.

export type PlantIdentificationPlan = 'free' | 'basic' | 'premium' | 'enterprise';

export function getPlantIdentificationMonthlyLimit(plan: PlantIdentificationPlan): number {
  if (plan === 'basic') return 50;
  if (plan === 'premium' || plan === 'enterprise') return 100;
  return 5;
}

export function currentMonthKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
