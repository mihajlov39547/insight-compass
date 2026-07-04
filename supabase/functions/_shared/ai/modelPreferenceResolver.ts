// @ts-nocheck
// Backend mirror of src/lib/modelPreferenceResolver.ts + src/config/modelCatalog.ts.
// Keep in sync when adding/removing models or changing plan gating.

export type PlanTier = 'free' | 'basic' | 'premium' | 'enterprise';
export type ModelFamily = 'auto' | 'gemini' | 'gpt' | 'gemma';
export type ThinkingLevel = 'low' | 'medium' | 'high';
export type ModelProviderHost = 'lovable_gateway' | 'google_direct';

export interface ModelCatalogEntry {
  id: string;
  provider: ModelProviderHost;
  family: Exclude<ModelFamily, 'auto'>;
  planTiers: PlanTier[];
  defaultThinkingLevel: ThinkingLevel;
  nativeThinking: boolean;
  fallbackIds: string[];
}

const ALL: PlanTier[] = ['free', 'basic', 'premium', 'enterprise'];
const BASIC_PLUS: PlanTier[] = ['basic', 'premium', 'enterprise'];
const PREMIUM_PLUS: PlanTier[] = ['premium', 'enterprise'];

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  { id: 'google/gemini-2.5-flash-lite', provider: 'lovable_gateway', family: 'gemini', planTiers: ALL, defaultThinkingLevel: 'low', nativeThinking: false, fallbackIds: ['google/gemini-2.5-flash'] },
  { id: 'google/gemini-2.5-flash', provider: 'lovable_gateway', family: 'gemini', planTiers: ALL, defaultThinkingLevel: 'medium', nativeThinking: false, fallbackIds: ['google/gemini-2.5-flash-lite'] },
  { id: 'google/gemini-3.5-flash', provider: 'lovable_gateway', family: 'gemini', planTiers: BASIC_PLUS, defaultThinkingLevel: 'medium', nativeThinking: false, fallbackIds: ['google/gemini-2.5-flash'] },
  { id: 'google/gemini-2.5-pro', provider: 'lovable_gateway', family: 'gemini', planTiers: ALL, defaultThinkingLevel: 'high', nativeThinking: false, fallbackIds: ['google/gemini-2.5-flash'] },
  { id: 'gemini-3.1', provider: 'google_direct', family: 'gemini', planTiers: BASIC_PLUS, defaultThinkingLevel: 'high', nativeThinking: true, fallbackIds: ['google/gemini-2.5-flash'] },
  { id: 'gemma-4', provider: 'google_direct', family: 'gemma', planTiers: BASIC_PLUS, defaultThinkingLevel: 'low', nativeThinking: true, fallbackIds: ['google/gemini-2.5-flash'] },
  { id: 'openai/gpt-5-mini', provider: 'lovable_gateway', family: 'gpt', planTiers: ALL, defaultThinkingLevel: 'low', nativeThinking: false, fallbackIds: ['google/gemini-2.5-flash'] },
  { id: 'openai/gpt-5', provider: 'lovable_gateway', family: 'gpt', planTiers: PREMIUM_PLUS, defaultThinkingLevel: 'medium', nativeThinking: false, fallbackIds: ['openai/gpt-5-mini'] },
  { id: 'openai/gpt-5.2', provider: 'lovable_gateway', family: 'gpt', planTiers: PREMIUM_PLUS, defaultThinkingLevel: 'high', nativeThinking: false, fallbackIds: ['openai/gpt-5'] },
  { id: 'openai/gpt-5.4-nano', provider: 'lovable_gateway', family: 'gpt', planTiers: PREMIUM_PLUS, defaultThinkingLevel: 'low', nativeThinking: false, fallbackIds: ['openai/gpt-5-mini'] },
  { id: 'openai/gpt-5.4-mini', provider: 'lovable_gateway', family: 'gpt', planTiers: PREMIUM_PLUS, defaultThinkingLevel: 'medium', nativeThinking: false, fallbackIds: ['openai/gpt-5-mini'] },
  { id: 'openai/gpt-5.4', provider: 'lovable_gateway', family: 'gpt', planTiers: PREMIUM_PLUS, defaultThinkingLevel: 'medium', nativeThinking: false, fallbackIds: ['openai/gpt-5.4-mini'] },
  { id: 'openai/gpt-5.4-pro', provider: 'lovable_gateway', family: 'gpt', planTiers: PREMIUM_PLUS, defaultThinkingLevel: 'high', nativeThinking: false, fallbackIds: ['openai/gpt-5.4'] },
  { id: 'openai/gpt-5.5', provider: 'lovable_gateway', family: 'gpt', planTiers: PREMIUM_PLUS, defaultThinkingLevel: 'high', nativeThinking: false, fallbackIds: ['openai/gpt-5.4'] },
  { id: 'openai/gpt-5.5-pro', provider: 'lovable_gateway', family: 'gpt', planTiers: PREMIUM_PLUS, defaultThinkingLevel: 'high', nativeThinking: false, fallbackIds: ['openai/gpt-5.5'] },
];

export const FAMILY_TIER_PREFERENCE: Record<Exclude<ModelFamily, 'auto'>, Record<ThinkingLevel, string[]>> = {
  gemini: {
    low: ['google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash'],
    medium: ['google/gemini-2.5-flash', 'google/gemini-3.5-flash', 'google/gemini-2.5-flash-lite'],
    high: ['google/gemini-2.5-pro', 'gemini-3.1', 'google/gemini-3.5-flash', 'google/gemini-2.5-flash'],
  },
  gpt: {
    low: ['openai/gpt-5.4-nano', 'openai/gpt-5-mini'],
    medium: ['openai/gpt-5.4-mini', 'openai/gpt-5', 'openai/gpt-5-mini'],
    high: ['openai/gpt-5.5-pro', 'openai/gpt-5.5', 'openai/gpt-5.4-pro', 'openai/gpt-5.4', 'openai/gpt-5.2', 'openai/gpt-5'],
  },
  // Gemma 4 is medium-only. The resolver always pins appliedThinkingLevel to
  // medium for the gemma family. The low/high arrays still resolve to
  // 'gemma-4' so the resolver never returns empty if a Gemma-medium pick
  // happens to be plan-locked at a different level; the UI marks low/high as
  // unsupported via familySupportsLevel().
  gemma: {
    low: ['gemma-4'],
    medium: ['gemma-4'],
    high: ['gemma-4'],
  },

};

const AUTO_TIER_PREFERENCE: Record<ThinkingLevel, string[]> = {
  low: ['google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash', 'openai/gpt-5-mini'],
  medium: ['google/gemini-2.5-flash', 'openai/gpt-5-mini', 'google/gemini-2.5-flash-lite'],
  high: ['google/gemini-2.5-pro', 'openai/gpt-5.5', 'openai/gpt-5', 'google/gemini-3.5-flash', 'google/gemini-2.5-flash'],
};

export interface ModelPreference { family: ModelFamily; thinkingLevel: ThinkingLevel; }
export interface ResolvedModelDecision {
  requestedFamily: ModelFamily;
  requestedThinkingLevel: ThinkingLevel;
  resolvedModelId: string;
  resolvedProvider: ModelProviderHost;
  appliedThinkingLevel: ThinkingLevel | null;
  nativeThinking: boolean;
  fallbackIds: string[];
  reason: string;
  planDowngraded: boolean;
}

export function getCatalogEntry(id: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

function isAllowedForPlan(id: string, plan: PlanTier): boolean {
  const e = getCatalogEntry(id);
  return !!e && e.planTiers.includes(plan);
}

function pickFirstAllowed(ids: string[], plan: PlanTier): string | null {
  for (const id of ids) if (isAllowedForPlan(id, plan)) return id;
  return null;
}

export function normalizeModelPreference(value: unknown): ModelPreference {
  const fam = (value as any)?.family;
  const lvl = (value as any)?.thinkingLevel;
  const family: ModelFamily =
    fam === 'gemini' || fam === 'gpt' || fam === 'gemma' || fam === 'auto' ? fam : 'auto';
  const thinkingLevel: ThinkingLevel =
    lvl === 'low' || lvl === 'medium' || lvl === 'high' ? lvl : 'medium';
  return { family, thinkingLevel };
}

export function resolveModelPreference(pref: ModelPreference, plan: PlanTier): ResolvedModelDecision {
  const requestedFamily = pref.family;
  const requestedThinkingLevel = pref.thinkingLevel;

  if (requestedFamily === 'auto') {
    const chosen = pickFirstAllowed(AUTO_TIER_PREFERENCE[requestedThinkingLevel], plan) ?? 'google/gemini-2.5-flash';
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

  let chosen = pickFirstAllowed(FAMILY_TIER_PREFERENCE[requestedFamily][requestedThinkingLevel], plan);
  let planDowngraded = false;
  let reason = 'family_tier_pick';

  if (!chosen) {
    for (const lvl of ['medium', 'low', 'high'] as ThinkingLevel[]) {
      if (lvl === requestedThinkingLevel) continue;
      const id = pickFirstAllowed(FAMILY_TIER_PREFERENCE[requestedFamily][lvl], plan);
      if (id) { chosen = id; planDowngraded = true; reason = 'plan_downgraded_within_family'; break; }
    }
  }

  if (!chosen) {
    const autoFallback = pickFirstAllowed(AUTO_TIER_PREFERENCE.medium, plan) ?? 'google/gemini-2.5-flash';
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
  const applied: ThinkingLevel = requestedFamily === 'gemma' ? 'medium' : requestedThinkingLevel;
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

/** Convert a thinking level to the Gemini/Gemma thinking config value. */
export function thinkingLevelToGeminiConfig(level: ThinkingLevel | null): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (level === 'low') return 'LOW';
  if (level === 'high') return 'HIGH';
  return 'MEDIUM';
}

/** Convert to OpenAI gateway reasoning_effort param. */
export function thinkingLevelToReasoningEffort(level: ThinkingLevel | null): 'low' | 'medium' | 'high' {
  return level === 'low' ? 'low' : level === 'high' ? 'high' : 'medium';
}
