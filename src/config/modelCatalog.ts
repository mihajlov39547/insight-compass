// Single source of truth for app-exposed AI models.
//
// Used by the chat model picker, plan gating, and the model-preference
// resolver. The backend has a mirrored copy at
// `supabase/functions/_shared/ai/modelPreferenceResolver.ts`. Keep both in
// sync when adding or removing models.

export type PlanTier = 'free' | 'basic' | 'premium' | 'enterprise';
export type ModelFamily = 'auto' | 'gemini' | 'gpt' | 'gemma';
export type ThinkingLevel = 'low' | 'medium' | 'high';
export type ModelProviderHost = 'lovable_gateway' | 'google_direct';

export interface ModelCatalogEntry {
  id: string;
  provider: ModelProviderHost;
  family: Exclude<ModelFamily, 'auto'>;
  label: string;
  planTiers: PlanTier[];
  /** Levels the model is considered a sensible pick for. */
  supportedThinkingLevels: ThinkingLevel[];
  defaultThinkingLevel: ThinkingLevel;
  /** True if the upstream API supports an explicit thinking-level config. */
  nativeThinking: boolean;
  costTier: 'low' | 'medium' | 'high' | 'premium';
  fallbackIds: string[];
}

const ALL: PlanTier[] = ['free', 'basic', 'premium', 'enterprise'];
const BASIC_PLUS: PlanTier[] = ['basic', 'premium', 'enterprise'];
const PREMIUM_PLUS: PlanTier[] = ['premium', 'enterprise'];

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  // ----- Gemini (Lovable Gateway) -----
  {
    id: 'google/gemini-2.5-flash-lite',
    provider: 'lovable_gateway',
    family: 'gemini',
    label: 'Gemini 2.5 Flash Lite',
    planTiers: ALL,
    supportedThinkingLevels: ['low'],
    defaultThinkingLevel: 'low',
    nativeThinking: false,
    costTier: 'low',
    fallbackIds: ['google/gemini-2.5-flash'],
  },
  {
    id: 'google/gemini-2.5-flash',
    provider: 'lovable_gateway',
    family: 'gemini',
    label: 'Gemini 2.5 Flash',
    planTiers: ALL,
    supportedThinkingLevels: ['low', 'medium'],
    defaultThinkingLevel: 'medium',
    nativeThinking: false,
    costTier: 'medium',
    fallbackIds: ['google/gemini-2.5-flash-lite'],
  },
  {
    id: 'google/gemini-3.5-flash',
    provider: 'lovable_gateway',
    family: 'gemini',
    label: 'Gemini 3.5 Flash',
    planTiers: BASIC_PLUS,
    supportedThinkingLevels: ['medium', 'high'],
    defaultThinkingLevel: 'medium',
    nativeThinking: false,
    costTier: 'medium',
    fallbackIds: ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite'],
  },
  {
    id: 'google/gemini-2.5-pro',
    provider: 'lovable_gateway',
    family: 'gemini',
    label: 'Gemini 2.5 Pro',
    planTiers: ALL,
    supportedThinkingLevels: ['high'],
    defaultThinkingLevel: 'high',
    nativeThinking: false,
    costTier: 'high',
    fallbackIds: ['google/gemini-2.5-flash'],
  },
  // ----- Gemini direct (Google AI Studio) -----
  {
    id: 'gemini-3.1',
    provider: 'google_direct',
    family: 'gemini',
    label: 'Gemini 3.1 (router)',
    planTiers: BASIC_PLUS,
    supportedThinkingLevels: ['low', 'medium', 'high'],
    defaultThinkingLevel: 'high',
    nativeThinking: true,
    costTier: 'medium',
    fallbackIds: ['google/gemini-2.5-flash'],
  },
  // ----- Gemma direct -----
  {
    id: 'gemma-4',
    provider: 'google_direct',
    family: 'gemma',
    label: 'Gemma 4',
    planTiers: BASIC_PLUS,
    supportedThinkingLevels: ['medium'],
    defaultThinkingLevel: 'medium',
    nativeThinking: true,
    costTier: 'low',
    fallbackIds: ['google/gemini-2.5-flash'],
  },
  // ----- OpenAI via Lovable Gateway -----
  {
    id: 'openai/gpt-5-mini',
    provider: 'lovable_gateway',
    family: 'gpt',
    label: 'GPT-5 mini',
    planTiers: ALL,
    supportedThinkingLevels: ['low', 'medium'],
    defaultThinkingLevel: 'low',
    nativeThinking: false,
    costTier: 'medium',
    fallbackIds: ['google/gemini-2.5-flash'],
  },
  {
    id: 'openai/gpt-5',
    provider: 'lovable_gateway',
    family: 'gpt',
    label: 'GPT-5',
    planTiers: PREMIUM_PLUS,
    supportedThinkingLevels: ['medium', 'high'],
    defaultThinkingLevel: 'medium',
    nativeThinking: false,
    costTier: 'high',
    fallbackIds: ['openai/gpt-5-mini', 'google/gemini-2.5-pro'],
  },
  {
    id: 'openai/gpt-5.2',
    provider: 'lovable_gateway',
    family: 'gpt',
    label: 'GPT-5.2',
    planTiers: PREMIUM_PLUS,
    supportedThinkingLevels: ['high'],
    defaultThinkingLevel: 'high',
    nativeThinking: false,
    costTier: 'high',
    fallbackIds: ['openai/gpt-5', 'openai/gpt-5-mini'],
  },
  {
    id: 'openai/gpt-5.4-nano',
    provider: 'lovable_gateway',
    family: 'gpt',
    label: 'GPT-5.4 nano',
    planTiers: PREMIUM_PLUS,
    supportedThinkingLevels: ['low'],
    defaultThinkingLevel: 'low',
    nativeThinking: false,
    costTier: 'low',
    fallbackIds: ['openai/gpt-5-mini'],
  },
  {
    id: 'openai/gpt-5.4-mini',
    provider: 'lovable_gateway',
    family: 'gpt',
    label: 'GPT-5.4 mini',
    planTiers: PREMIUM_PLUS,
    supportedThinkingLevels: ['low', 'medium'],
    defaultThinkingLevel: 'medium',
    nativeThinking: false,
    costTier: 'medium',
    fallbackIds: ['openai/gpt-5-mini'],
  },
  {
    id: 'openai/gpt-5.4',
    provider: 'lovable_gateway',
    family: 'gpt',
    label: 'GPT-5.4',
    planTiers: PREMIUM_PLUS,
    supportedThinkingLevels: ['medium', 'high'],
    defaultThinkingLevel: 'medium',
    nativeThinking: false,
    costTier: 'high',
    fallbackIds: ['openai/gpt-5.4-mini', 'openai/gpt-5-mini'],
  },
  {
    id: 'openai/gpt-5.4-pro',
    provider: 'lovable_gateway',
    family: 'gpt',
    label: 'GPT-5.4 Pro',
    planTiers: PREMIUM_PLUS,
    supportedThinkingLevels: ['high'],
    defaultThinkingLevel: 'high',
    nativeThinking: false,
    costTier: 'premium',
    fallbackIds: ['openai/gpt-5.4', 'openai/gpt-5'],
  },
  {
    id: 'openai/gpt-5.5',
    provider: 'lovable_gateway',
    family: 'gpt',
    label: 'GPT-5.5',
    planTiers: PREMIUM_PLUS,
    supportedThinkingLevels: ['medium', 'high'],
    defaultThinkingLevel: 'high',
    nativeThinking: false,
    costTier: 'high',
    fallbackIds: ['openai/gpt-5.4', 'openai/gpt-5'],
  },
  {
    id: 'openai/gpt-5.5-pro',
    provider: 'lovable_gateway',
    family: 'gpt',
    label: 'GPT-5.5 Pro',
    planTiers: PREMIUM_PLUS,
    supportedThinkingLevels: ['high'],
    defaultThinkingLevel: 'high',
    nativeThinking: false,
    costTier: 'premium',
    fallbackIds: ['openai/gpt-5.5', 'openai/gpt-5.4-pro'],
  },
];

export function getCatalogEntry(id: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

export const ALL_MODEL_IDS = MODEL_CATALOG.map((m) => m.id);

// ---------------------------------------------------------------------------
// Per-family tier picks. These IDs MUST exist in the catalog above.
// Resolver downgrades within the family if a tier isn't allowed for the plan.
// ---------------------------------------------------------------------------

export const FAMILY_TIER_PREFERENCE: Record<
  Exclude<ModelFamily, 'auto'>,
  Record<ThinkingLevel, string[]>
> = {
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
  gemma: {
    low: ['gemma-4'],
    medium: ['gemma-4'],
    high: ['gemma-4'],
  },
};

/** Family-level plan availability: a family is available if ANY model in it is allowed. */
export function isFamilyAvailableForPlan(
  family: Exclude<ModelFamily, 'auto'>,
  plan: PlanTier,
): boolean {
  return MODEL_CATALOG.some((m) => m.family === family && m.planTiers.includes(plan));
}

/** Map a legacy raw model id (or "auto") to a family + thinking level. */
export function inferPreferenceFromLegacyModelId(
  modelId: string | undefined | null,
): { family: ModelFamily; thinkingLevel: ThinkingLevel } {
  if (!modelId || modelId === 'auto') {
    return { family: 'auto', thinkingLevel: 'medium' };
  }
  const entry = getCatalogEntry(modelId);
  if (entry) {
    return { family: entry.family, thinkingLevel: entry.defaultThinkingLevel };
  }
  // Best-effort inference for unknown ids.
  if (modelId.startsWith('openai/')) return { family: 'gpt', thinkingLevel: 'medium' };
  if (modelId.startsWith('google/')) return { family: 'gemini', thinkingLevel: 'medium' };
  if (modelId.startsWith('gemma')) return { family: 'gemma', thinkingLevel: 'medium' };
  if (modelId.startsWith('gemini')) return { family: 'gemini', thinkingLevel: 'high' };
  return { family: 'auto', thinkingLevel: 'medium' };
}
