// Resolves a (family, thinkingLevel) preference into a concrete model id.
// The backend has a mirrored copy at
// `supabase/functions/_shared/ai/modelPreferenceResolver.ts` — keep both in
// sync.

import {
  FAMILY_TIER_PREFERENCE,
  MODEL_CATALOG,
  getCatalogEntry,
  type ModelFamily,
  type PlanTier,
  type ThinkingLevel,
} from '@/config/modelCatalog';

export interface ModelPreference {
  family: ModelFamily;
  thinkingLevel: ThinkingLevel;
}

export interface ResolvedModelDecision {
  requestedFamily: ModelFamily;
  requestedThinkingLevel: ThinkingLevel;
  resolvedModelId: string;
  resolvedProvider: 'lovable_gateway' | 'google_direct';
  appliedThinkingLevel: ThinkingLevel | null;
  nativeThinking: boolean;
  fallbackIds: string[];
  reason: string;
  planDowngraded: boolean;
}

// Per-level pick when family === 'auto'. Tries to honor the level via tier.
const AUTO_TIER_PREFERENCE: Record<ThinkingLevel, string[]> = {
  low: ['google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash', 'openai/gpt-5-mini'],
  medium: ['google/gemini-2.5-flash', 'openai/gpt-5-mini', 'google/gemini-2.5-flash-lite'],
  high: ['google/gemini-2.5-pro', 'openai/gpt-5.5', 'openai/gpt-5', 'google/gemini-3.5-flash', 'google/gemini-2.5-flash'],
};

function isAllowedForPlan(modelId: string, plan: PlanTier): boolean {
  const entry = getCatalogEntry(modelId);
  return !!entry && entry.planTiers.includes(plan);
}

function pickFirstAllowed(ids: string[], plan: PlanTier): string | null {
  for (const id of ids) {
    if (isAllowedForPlan(id, plan)) return id;
  }
  return null;
}

export function resolveModelPreference(
  pref: ModelPreference,
  plan: PlanTier,
): ResolvedModelDecision {
  const requestedFamily = pref.family;
  const requestedThinkingLevel = pref.thinkingLevel;

  // ---- auto -------------------------------------------------------------
  if (requestedFamily === 'auto') {
    const candidates = AUTO_TIER_PREFERENCE[requestedThinkingLevel];
    const chosen = pickFirstAllowed(candidates, plan) ?? 'google/gemini-2.5-flash';
    const entry = getCatalogEntry(chosen);
    return {
      requestedFamily,
      requestedThinkingLevel,
      resolvedModelId: chosen,
      resolvedProvider: entry?.provider ?? 'lovable_gateway',
      appliedThinkingLevel: requestedThinkingLevel,
      nativeThinking: entry?.nativeThinking ?? false,
      fallbackIds: entry?.fallbackIds ?? [],
      reason: 'auto_tier_pick',
      planDowngraded: false,
    };
  }

  // ---- explicit family --------------------------------------------------
  const tierCandidates = FAMILY_TIER_PREFERENCE[requestedFamily][requestedThinkingLevel];
  let chosen = pickFirstAllowed(tierCandidates, plan);
  let planDowngraded = false;
  let reason = 'family_tier_pick';

  if (!chosen) {
    // Try other levels within the same family.
    const fallbackOrder: ThinkingLevel[] = ['medium', 'low', 'high'];
    for (const lvl of fallbackOrder) {
      if (lvl === requestedThinkingLevel) continue;
      const id = pickFirstAllowed(FAMILY_TIER_PREFERENCE[requestedFamily][lvl], plan);
      if (id) {
        chosen = id;
        planDowngraded = true;
        reason = 'plan_downgraded_within_family';
        break;
      }
    }
  }

  if (!chosen) {
    // Family entirely unavailable for this plan — drop to auto-medium pick.
    const autoFallback = pickFirstAllowed(AUTO_TIER_PREFERENCE.medium, plan)
      ?? 'google/gemini-2.5-flash';
    const entry = getCatalogEntry(autoFallback);
    return {
      requestedFamily,
      requestedThinkingLevel,
      resolvedModelId: autoFallback,
      resolvedProvider: entry?.provider ?? 'lovable_gateway',
      appliedThinkingLevel: 'medium',
      nativeThinking: entry?.nativeThinking ?? false,
      fallbackIds: entry?.fallbackIds ?? [],
      reason: 'plan_downgraded_to_auto',
      planDowngraded: true,
    };
  }

  const entry = getCatalogEntry(chosen)!;
  // Gemma 4 supports only Instant (low) and High. Medium requests are
  // normalized to 'low' — never send Medium to the Gemma provider.
  let applied: ThinkingLevel = requestedThinkingLevel;
  if (requestedFamily === 'gemma' && applied === 'medium') applied = 'low';
  return {
    requestedFamily,
    requestedThinkingLevel,
    resolvedModelId: chosen,
    resolvedProvider: entry.provider,
    appliedThinkingLevel: applied,
    nativeThinking: entry.nativeThinking,
    fallbackIds: entry.fallbackIds,
    reason,
    planDowngraded,
  };
}

/** Validate preference shape coming from settings or request payload. */
export function normalizeModelPreference(value: unknown): ModelPreference {
  const fam = (value as any)?.family;
  const lvl = (value as any)?.thinkingLevel;
  const family: ModelFamily =
    fam === 'gemini' || fam === 'gpt' || fam === 'gemma' || fam === 'auto' ? fam : 'auto';
  const thinkingLevel: ThinkingLevel =
    lvl === 'low' || lvl === 'medium' || lvl === 'high' ? lvl : 'medium';
  return { family, thinkingLevel };
}

/** True if the given thinking level has a distinct catalog entry for the family. */
export function familySupportsLevel(
  family: ModelFamily,
  level: ThinkingLevel,
): boolean {
  if (family === 'auto') return true;
  if (family === 'gemma') return level === 'medium';
  const ids = FAMILY_TIER_PREFERENCE[family][level];
  return MODEL_CATALOG.some((m) => ids.includes(m.id));
}

export type Availability = 'available' | 'plan_locked' | 'unsupported';

/**
 * Plan-aware UI hint for a (family, level) pair.
 * - 'available'    → user may select and request will succeed
 * - 'plan_locked'  → family/level exists but user's plan can't access any model
 * - 'unsupported'  → family does not have this level at all (e.g. Gemma low/high)
 */
export function getFamilyLevelAvailability(
  family: ModelFamily,
  level: ThinkingLevel,
  plan: PlanTier,
): Availability {
  if (!familySupportsLevel(family, level)) return 'unsupported';
  if (family === 'auto') return 'available';
  const ids = FAMILY_TIER_PREFERENCE[family][level];
  const anyAllowed = ids.some((id) => {
    const e = MODEL_CATALOG.find((m) => m.id === id);
    return !!e && e.planTiers.includes(plan);
  });
  return anyAllowed ? 'available' : 'plan_locked';
}

/** Same shape but for the family as a whole (any level). */
export function getFamilyAvailability(
  family: ModelFamily,
  plan: PlanTier,
): Availability {
  if (family === 'auto') return 'available';
  const anyAllowed = MODEL_CATALOG.some(
    (m) => m.family === family && m.planTiers.includes(plan),
  );
  return anyAllowed ? 'available' : 'plan_locked';
}

