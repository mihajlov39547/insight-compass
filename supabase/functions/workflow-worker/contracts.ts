export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type ErrorTaxonomyCategory =
  | "transient"
  | "permanent"
  | "validation"
  | "dependency_input"
  | "external_timeout";

export interface WorkerRequest {
  max_activities_to_process?: number;
  lease_seconds?: number;
  handler_keys?: string[];
  debug?: boolean;
}

export interface WorkerResponse {
  processed_count: number;
  claimed_count: number;
  completed_count: number;
  failed_count: number;
  retried_count: number;
  workflow_run_ids_touched: string[];
  activity_run_ids_processed: string[];
  message: string;
}

export interface ActivityExecutionContext {
  activity_run: {
    id: string;
    workflow_run_id: string;
    activity_id: string;
    activity_key: string;
    activity_name: string;
    handler_key: string;
    status: string;
    attempt_count: number;
    max_attempts: number;
    is_optional: boolean;
    is_terminal: boolean;
    input_payload: JsonValue;
    retry_backoff_seconds: number;
    retry_backoff_multiplier: number;
    version_id: string;
  };
  workflow_run: {
    id: string;
    workflow_definition_id: string;
    version_id: string;
    status: string;
    context: JsonObject;
    input_payload: JsonValue;
  };
}

export interface HandlerExecutionInput {
  workflow_run_id: string;
  activity_run_id: string;
  workflow_definition_id: string;
  workflow_context: JsonObject;
  activity_input_payload: JsonValue;
  activity_key: string;
  handler_key: string;
  attempt_count: number;
  max_attempts: number;
}

export type TerminalErrorClassification = "retryable" | "terminal";

export interface HandlerSuccess {
  ok: true;
  output_payload: JsonValue;
  context_patch?: JsonObject;
}

export interface HandlerFailure {
  ok: false;
  error: {
    classification: TerminalErrorClassification;
    category?: ErrorTaxonomyCategory;
    message: string;
    code?: string;
    details?: JsonValue;
  };
  context_patch?: JsonObject;
}

export type HandlerResult = HandlerSuccess | HandlerFailure;

export type Handler = (input: HandlerExecutionInput) => Promise<HandlerResult>;
