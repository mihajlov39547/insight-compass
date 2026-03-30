/*
 * Phase 1 runtime contracts for activity handlers.
 * Contract-only module: no runtime behavior.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type TerminalErrorClassification = "retryable" | "terminal";

export interface ActivityHandlerTraceContext {
  request_id?: string;
  correlation_id?: string;
  worker_id?: string;
}

export interface ActivityHandlerTimingContext {
  now_iso?: string;
  claimed_at?: string | null;
  lease_expires_at?: string | null;
  started_at?: string | null;
}

export interface ActivityHandlerInput {
  workflow_run_id: string;
  activity_run_id: string;
  workflow_definition_id: string;
  workflow_definition_key?: string;
  workflow_version_id: string;
  workflow_version_number?: number;
  activity_id: string;
  activity_key: string;
  activity_name: string;
  handler_key: string;
  attempt_count: number;
  max_attempts: number;
  workflow_context: JsonObject;
  activity_input_payload: JsonValue;
  trace?: ActivityHandlerTraceContext;
  timing?: ActivityHandlerTimingContext;
}

export interface ActivityHandlerSuccess {
  ok: true;
  output_payload: JsonValue;
  context_patch?: JsonObject;
  metrics?: {
    duration_ms?: number;
  };
}

export interface ActivityHandlerFailure {
  ok: false;
  error: {
    classification: TerminalErrorClassification;
    message: string;
    code?: string;
    details?: JsonValue;
    retry_after_seconds?: number;
  };
  context_patch?: JsonObject;
}

export type ActivityHandlerResult = ActivityHandlerSuccess | ActivityHandlerFailure;

export const HANDLER_CONTRACT_RULES = {
  mutates_shared_context_directly: false,
  mutates_workflow_runs_directly: false,
  mutates_activity_runs_directly: false,
  returns_structured_result_only: true,
} as const;
