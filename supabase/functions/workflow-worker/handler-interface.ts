import type {
  HandlerExecutionInput,
  JsonValue,
  JsonObject,
  TerminalErrorClassification,
  ErrorTaxonomyCategory,
} from "./contracts.ts";

/**
 * Normalized handler execution result.
 * Handlers return this shape; worker applies side effects.
 */
export interface HandlerSuccessResult {
  ok: true;
  output_payload: JsonValue;
  context_patch?: JsonObject;
  metadata?: {
    duration_ms?: number;
    handler_category?: string;
  };
}

export interface HandlerErrorResult {
  ok: false;
  error: {
    classification: TerminalErrorClassification;
    category?: ErrorTaxonomyCategory;
    message: string;
    code?: string;
    details?: JsonValue;
  };
  context_patch?: JsonObject;
  metadata?: {
    duration_ms?: number;
  };
}

export type HandlerOutput = HandlerSuccessResult | HandlerErrorResult;

/**
 * Handler definition: async function that takes execution input and returns normalized output.
 * Handlers are pure business logic; orchestrator applies durable state changes.
 */
export type Handler = (input: HandlerExecutionInput) => Promise<HandlerOutput>;

/**
 * Handler registry entry for introspection and metadata.
 */
export interface HandlerDefinition {
  key: string;
  category: "debug" | "document" | "integration" | "compute" | "other";
  timeout_seconds?: number;
  description: string;
  handler: Handler;
}

/**
 * Handler execution frame for logging and tracing.
 */
export interface HandlerExecutionFrame {
  workflow_run_id: string;
  activity_run_id: string;
  activity_key: string;
  handler_key: string;
  attempt_count: number;
  timestamp_start_iso: string;
}
