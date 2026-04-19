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

export interface ModelResolutionContext {
  complexity?: "low" | "medium" | "high";
  contextSize?: "small" | "medium" | "large";
  latencySensitivity?: "low" | "medium" | "high";
  costSensitivity?: "low" | "medium" | "high";
  isUserFacing?: boolean;
  needsStructuredOutput?: boolean;
}

export const TASK_MODEL_CONFIG: Record<ModelTask, string> = {
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

export const CHAT_MODEL_ALLOWLIST = [
  TASK_MODEL_CONFIG.chat_complex,
  TASK_MODEL_CONFIG.chat_default,
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  // Keep available for explicit user selection in picker; not used as routed default.
  "openai/gpt-5-mini",
];

export function getModelForTask(task: ModelTask): string {
  return TASK_MODEL_CONFIG[task];
}

export function resolveModelForTask(
  task: ModelTask,
  _context?: ModelResolutionContext
): string {
  // Placeholder for future policy routing by complexity/context/latency/cost.
  return getModelForTask(task);
}
