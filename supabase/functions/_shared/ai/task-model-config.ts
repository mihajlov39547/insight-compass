// @ts-nocheck

export type ModelTask =
  | "chat_default"
  | "chat_grounded"
  | "chat_complex"
  | "title_generation"
  | "notebook_metadata"
  | "summarization_fast"
  | "summarization_rich"
  | "scope_check"
  | "classification"
  | "prompt_improvement"
  | "project_description"
  | "question_generation"
  | "transcript_question_generation"
  | "chunk_generation"
  | "extract_synthesis";

export type ModelId =
  | "google/gemini-3-flash-preview"
  | "google/gemini-2.5-flash-lite"
  | "google/gemini-2.5-flash"
  | "google/gemini-2.5-pro"
  | "openai/gpt-5-mini"
  | "openai/gpt-5"
  | "openai/gpt-5.2";

export type ModelVisibility = "public" | "internal";

export interface ModelMetadata {
  id: ModelId;
  displayName: string;
  visibility: ModelVisibility;
  internalOnly: boolean;
  selectable: boolean;
  costTier: "low" | "medium" | "high";
  latencyTier: "fast" | "balanced" | "slow";
  reasoningTier: "basic" | "standard" | "advanced";
  suitableTasks: ModelTask[];
}

export interface ResolveModelContext {
  promptLength?: number;
  contextLength?: number;
  sourceCount?: number;
  complexity?: "low" | "medium" | "high";
  latencySensitive?: boolean;
  costSensitive?: boolean;
  isUserFacing?: boolean;
  requiresStructuredOutput?: boolean;

  // Optional forward-compatible signals.
  contextSize?: "small" | "medium" | "large";
}

export interface ModelResolutionDecision {
  model: ModelId;
  reason: string;
  appliedRules: string[];
  task: ModelTask;
  candidates: ModelId[];
  normalizedContext: Required<Pick<ResolveModelContext, "promptLength" | "contextLength" | "sourceCount" | "isUserFacing" | "requiresStructuredOutput" | "latencySensitive" | "costSensitive">> & {
    complexity: "low" | "medium" | "high";
  };
}

export const MODEL_REGISTRY: Record<ModelId, ModelMetadata> = {
  "google/gemini-3-flash-preview": {
    id: "google/gemini-3-flash-preview",
    displayName: "gemini-3-flash-preview",
    visibility: "public",
    internalOnly: false,
    selectable: true,
    costTier: "medium",
    latencyTier: "balanced",
    reasoningTier: "standard",
    suitableTasks: ["chat_default", "chat_grounded"],
  },
  "google/gemini-2.5-flash-lite": {
    id: "google/gemini-2.5-flash-lite",
    displayName: "gemini-2.5-flash-lite",
    visibility: "public",
    internalOnly: false,
    selectable: true,
    costTier: "low",
    latencyTier: "fast",
    reasoningTier: "basic",
    suitableTasks: [
      "scope_check",
      "classification",
      "prompt_improvement",
      "question_generation",
      "transcript_question_generation",
      "chunk_generation",
      "title_generation",
      "summarization_fast",
    ],
  },
  "google/gemini-2.5-flash": {
    id: "google/gemini-2.5-flash",
    displayName: "gemini-2.5-flash",
    visibility: "public",
    internalOnly: false,
    selectable: true,
    costTier: "medium",
    latencyTier: "balanced",
    reasoningTier: "standard",
    suitableTasks: ["notebook_metadata", "project_description", "summarization_rich", "extract_synthesis"],
  },
  "google/gemini-2.5-pro": {
    id: "google/gemini-2.5-pro",
    displayName: "gemini-2.5-pro",
    visibility: "public",
    internalOnly: false,
    selectable: true,
    costTier: "high",
    latencyTier: "slow",
    reasoningTier: "advanced",
    suitableTasks: ["chat_complex"],
  },
  "openai/gpt-5-mini": {
    id: "openai/gpt-5-mini",
    displayName: "gpt-5-mini",
    visibility: "public",
    internalOnly: false,
    selectable: true,
    costTier: "medium",
    latencyTier: "balanced",
    reasoningTier: "advanced",
    suitableTasks: ["chat_default", "chat_grounded"],
  },
  "openai/gpt-5": {
    id: "openai/gpt-5",
    displayName: "gpt-5",
    visibility: "public",
    internalOnly: false,
    selectable: true,
    costTier: "high",
    latencyTier: "slow",
    reasoningTier: "advanced",
    // Manual-selection only — not used for routed tasks.
    suitableTasks: [],
  },
  "openai/gpt-5.2": {
    id: "openai/gpt-5.2",
    displayName: "gpt-5.2",
    visibility: "public",
    internalOnly: false,
    selectable: true,
    costTier: "high",
    latencyTier: "slow",
    reasoningTier: "advanced",
    // Manual-selection only — not used for routed tasks.
    suitableTasks: [],
  },
};

export const TASK_MODEL_CONFIG: Record<ModelTask, ModelId> = {
  chat_default: "google/gemini-3-flash-preview",
  chat_grounded: "google/gemini-3-flash-preview",
  chat_complex: "google/gemini-2.5-pro",
  scope_check: "google/gemini-2.5-flash-lite",
  classification: "google/gemini-2.5-flash-lite",
  prompt_improvement: "google/gemini-2.5-flash-lite",
  question_generation: "google/gemini-2.5-flash-lite",
  transcript_question_generation: "google/gemini-2.5-flash-lite",
  chunk_generation: "google/gemini-2.5-flash-lite",
  title_generation: "google/gemini-2.5-flash-lite",
  notebook_metadata: "google/gemini-2.5-flash",
  project_description: "google/gemini-2.5-flash",
  summarization_rich: "google/gemini-2.5-flash",
  extract_synthesis: "google/gemini-2.5-flash",
  summarization_fast: "google/gemini-2.5-flash-lite",
};

export const DEFAULT_CHAT_MODEL = TASK_MODEL_CONFIG.chat_default;

export const CHAT_MODEL_ALLOWLIST: ModelId[] = [
  TASK_MODEL_CONFIG.chat_complex,
  TASK_MODEL_CONFIG.chat_default,
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  // Available for explicit selection and auto-candidate routing for short concise chat.
  "openai/gpt-5-mini",
  // Manual-selection only — not used by auto routing for any task.
  "openai/gpt-5",
  "openai/gpt-5.2",
];

export const PUBLIC_SELECTABLE_MODELS: ModelId[] = Object.values(MODEL_REGISTRY)
  .filter((m) => m.visibility === "public" && m.selectable && !m.internalOnly)
  .map((m) => m.id);

export function getModelForTask(task: ModelTask): ModelId {
  return TASK_MODEL_CONFIG[task];
}

function inferComplexity(
  task: ModelTask,
  promptLength: number,
  contextLength: number,
  sourceCount: number,
  requiresStructuredOutput: boolean,
  explicitComplexity?: "low" | "medium" | "high"
): "low" | "medium" | "high" {
  if (explicitComplexity) return explicitComplexity;
  if (task === "chat_complex") return "high";

  let score = 0;
  if (promptLength >= 900) score += 2;
  else if (promptLength >= 300) score += 1;

  if (contextLength >= 14000) score += 2;
  else if (contextLength >= 3500) score += 1;

  if (sourceCount >= 8) score += 2;
  else if (sourceCount >= 3) score += 1;

  if (requiresStructuredOutput) score += 1;

  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}

export function resolveModelDecision(
  task: ModelTask,
  context: ResolveModelContext = {}
): ModelResolutionDecision {
  const baseline = getModelForTask(task);
  const promptLength = Math.max(0, context.promptLength ?? 0);
  const contextLength = Math.max(0, context.contextLength ?? 0);
  const sourceCount = Math.max(0, context.sourceCount ?? 0);
  const isUserFacing = context.isUserFacing ?? true;
  const requiresStructuredOutput = context.requiresStructuredOutput ?? false;
  const latencySensitive = context.latencySensitive ?? false;
  const costSensitive = context.costSensitive ?? false;
  const complexity = inferComplexity(
    task,
    promptLength,
    contextLength,
    sourceCount,
    requiresStructuredOutput,
    context.complexity
  );

  const normalizedContext = {
    promptLength,
    contextLength,
    sourceCount,
    complexity,
    isUserFacing,
    requiresStructuredOutput,
    latencySensitive,
    costSensitive,
  };

  const candidates: ModelId[] = [
    "google/gemini-3-flash-preview",
    "openai/gpt-5-mini",
    "google/gemini-2.5-flash",
    "google/gemini-2.5-pro",
    "google/gemini-2.5-flash-lite",
  ];
  const appliedRules: string[] = [];

  const isUtilityTask = new Set<ModelTask>([
    "scope_check",
    "classification",
    "prompt_improvement",
    "question_generation",
    "transcript_question_generation",
    "chunk_generation",
    "title_generation",
    "summarization_fast",
  ]).has(task);

  if (isUtilityTask || !isUserFacing) {
    appliedRules.push("utility-or-background-baseline");
    return {
      model: baseline,
      reason: "Utility/background task uses mapped low-cost baseline model",
      appliedRules,
      task,
      candidates,
      normalizedContext,
    };
  }

  if (task !== "chat_default" && task !== "chat_grounded" && task !== "chat_complex") {
    appliedRules.push("non-chat-task-baseline");
    return {
      model: baseline,
      reason: "Non-chat task uses explicit task mapping baseline",
      appliedRules,
      task,
      candidates,
      normalizedContext,
    };
  }

  if (
    complexity === "high" ||
    contextLength >= 14000 ||
    sourceCount >= 8 ||
    promptLength >= 1400
  ) {
    appliedRules.push("high-complexity-or-long-context");
    return {
      model: "google/gemini-2.5-pro",
      reason: "High complexity / large context / many sources justified pro reasoning",
      appliedRules,
      task,
      candidates,
      normalizedContext,
    };
  }

  if (
    complexity === "medium" ||
    contextLength >= 3500 ||
    sourceCount >= 3 ||
    requiresStructuredOutput
  ) {
    if (
      promptLength <= 320 &&
      contextLength <= 2500 &&
      sourceCount <= 2 &&
      !costSensitive &&
      !requiresStructuredOutput
    ) {
      appliedRules.push("medium-context-short-concise-gpt5mini");
      return {
        model: "openai/gpt-5-mini",
        reason: "Medium synthesis with short prompt/context favored concise high-quality response",
        appliedRules,
        task,
        candidates,
        normalizedContext,
      };
    }

    appliedRules.push("medium-context-synthesis-flash");
    return {
      model: "google/gemini-2.5-flash",
      reason: "Medium synthesis/context routed to balanced flash model",
      appliedRules,
      task,
      candidates,
      normalizedContext,
    };
  }

  if (
    promptLength <= 260 &&
    contextLength <= 1800 &&
    sourceCount <= 2 &&
    !costSensitive &&
    !latencySensitive
  ) {
    appliedRules.push("short-concise-gpt5mini");
    return {
      model: "openai/gpt-5-mini",
      reason: "Short low-context user chat can favor concise gpt-5-mini responses",
      appliedRules,
      task,
      candidates,
      normalizedContext,
    };
  }

  appliedRules.push("normal-user-chat-default");
  return {
    model: "google/gemini-3-flash-preview",
    reason: "Normal user-facing chat uses gemini-3-flash-preview baseline",
    appliedRules,
    task,
    candidates,
    normalizedContext,
  };
}

export function resolveModelForTask(
  task: ModelTask,
  context: ResolveModelContext = {}
): ModelId {
  return resolveModelDecision(task, context).model;
}
