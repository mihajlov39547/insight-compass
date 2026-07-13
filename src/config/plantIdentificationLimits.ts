// Plant AI scan monthly limits per plan.
// A "Plant AI scan" is ANY of: plant identification OR disease diagnosis.
// Both increment the same monthly counter.
// Backend must remain authoritative; the edge functions mirror these values.

export type PlantAiScanPlan = 'free' | 'basic' | 'premium' | 'enterprise';
// Back-compat alias.
export type PlantIdentificationPlan = PlantAiScanPlan;

export function getPlantAiScanMonthlyLimit(plan: PlantAiScanPlan): number {
  if (plan === 'basic') return 50;
  if (plan === 'premium' || plan === 'enterprise') return 100;
  return 10;
}

// Back-compat alias for legacy imports.
export const getPlantIdentificationMonthlyLimit = getPlantAiScanMonthlyLimit;

export function currentMonthKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
