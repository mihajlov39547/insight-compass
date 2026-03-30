import type {
  JsonValue,
  TerminalErrorClassification,
  ErrorTaxonomyCategory,
} from "./contracts.ts";

export interface FailureErrorInput {
  classification?: TerminalErrorClassification;
  category?: ErrorTaxonomyCategory;
  code?: string;
  message: string;
  details?: JsonValue;
}

export interface NormalizedFailureError {
  classification: TerminalErrorClassification;
  category: ErrorTaxonomyCategory;
  code?: string;
  message: string;
  details?: JsonValue;
}

const CATEGORY_TO_CLASSIFICATION: Record<
  ErrorTaxonomyCategory,
  TerminalErrorClassification
> = {
  // Phase 6 MVP mapping:
  // transient/external_timeout => retryable, others => terminal.
  transient: "retryable",
  external_timeout: "retryable",
  validation: "terminal",
  dependency_input: "terminal",
  permanent: "terminal",
};

function inferCategoryFromCodeOrMessage(
  code?: string,
  message?: string,
  fallbackClassification?: TerminalErrorClassification
): ErrorTaxonomyCategory {
  const upperCode = (code ?? "").toUpperCase();
  const upperMessage = (message ?? "").toUpperCase();

  if (upperCode.includes("TIMEOUT") || upperMessage.includes("TIMEOUT")) {
    return "external_timeout";
  }

  if (
    upperCode.includes("VALIDATION") ||
    upperCode.includes("INVALID") ||
    upperMessage.includes("VALIDATION") ||
    upperMessage.includes("INVALID")
  ) {
    return "validation";
  }

  if (
    upperCode.includes("DEPENDENCY") ||
    upperCode.includes("INPUT") ||
    upperCode.includes("MISSING") ||
    upperMessage.includes("DEPENDENCY") ||
    upperMessage.includes("UPSTREAM")
  ) {
    return "dependency_input";
  }

  if (
    upperCode.includes("PERMANENT") ||
    upperCode.includes("TERMINAL") ||
    upperCode.includes("HANDLER_NOT_FOUND")
  ) {
    return "permanent";
  }

  if (
    upperCode.includes("RETRY") ||
    upperCode.includes("TRANSIENT")
  ) {
    return "transient";
  }

  return fallbackClassification === "retryable" ? "transient" : "permanent";
}

export function normalizeFailureError(
  error: FailureErrorInput
): NormalizedFailureError {
  const inferredCategory = inferCategoryFromCodeOrMessage(
    error.code,
    error.message,
    error.classification
  );

  const category = error.category ?? inferredCategory;

  // Preserve explicit handler classification when provided; otherwise map from category.
  const classification =
    error.classification ?? CATEGORY_TO_CLASSIFICATION[category];

  return {
    classification,
    category,
    code: error.code,
    message: error.message,
    details: error.details,
  };
}

export interface RetryComputationInput {
  attemptNumber: number;
  maxAttempts: number;
  retryBackoffSeconds: number;
  retryBackoffMultiplier: number;
  now?: Date;
}

export interface RetryComputationResult {
  attemptsRemaining: boolean;
  delaySeconds: number;
  nextRetryAt: string | null;
}

/**
 * Deterministic exponential backoff helper used for waiting_retry scheduling.
 * Formula (MVP): base_seconds * (multiplier ^ (attempt_number - 1)).
 */
export function computeNextRetrySchedule(
  input: RetryComputationInput
): RetryComputationResult {
  const now = input.now ?? new Date();

  const rawAttemptNumber = Number(input.attemptNumber);
  const attemptNumber = Number.isFinite(rawAttemptNumber)
    ? Math.max(1, Math.floor(rawAttemptNumber))
    : 1;

  const rawMaxAttempts = Number(input.maxAttempts);
  const maxAttempts = Number.isFinite(rawMaxAttempts)
    ? Math.max(1, Math.floor(rawMaxAttempts))
    : 1;

  const attemptsRemaining = attemptNumber < maxAttempts;

  const rawBackoffSeconds = Number(input.retryBackoffSeconds);
  const baseSeconds = Number.isFinite(rawBackoffSeconds)
    ? Math.max(1, Math.floor(rawBackoffSeconds))
    : 1;

  // Allow 1.0 for fixed interval retries; clamp below 1.0 upward.
  const rawMultiplier = Number(input.retryBackoffMultiplier);
  const multiplier = Number.isFinite(rawMultiplier)
    ? Math.max(1, rawMultiplier)
    : 1;

  const rawDelaySeconds =
    baseSeconds * Math.pow(multiplier, Math.max(attemptNumber - 1, 0));

  // Clamp to one week to avoid runaway values from invalid multipliers.
  const delaySeconds = Math.min(Math.max(Math.round(rawDelaySeconds), 1), 604800);

  if (!attemptsRemaining) {
    return {
      attemptsRemaining,
      delaySeconds,
      nextRetryAt: null,
    };
  }

  const nextRetryAt = new Date(now.getTime() + delaySeconds * 1000).toISOString();

  return {
    attemptsRemaining,
    delaySeconds,
    nextRetryAt,
  };
}
