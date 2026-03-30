export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface StartWorkflowRunRequest {
  definition_key: string;
  input_payload?: JsonValue;
  user_id?: string | null;
  trigger_entity_type?: string | null;
  trigger_entity_id?: string | null;
  idempotency_key?: string | null;
  create_initial_context_snapshot?: boolean;
}

export interface StartWorkflowRunResponse {
  workflow_run_id: string;
  workflow_definition_id: string;
  version_id: string;
  status: string;
  created_activity_run_count: number;
  queued_entry_activity_count: number;
  idempotent_reuse: boolean;
  message: string;
}

export interface WorkflowDefinitionRecord {
  id: string;
  key: string;
  status: string;
}

export interface WorkflowDefinitionVersionRecord {
  id: string;
  workflow_definition_id: string;
  version: number;
  is_current: boolean;
  default_context: JsonValue;
}

export interface WorkflowActivityRecord {
  id: string;
  key: string;
  name: string;
  handler_key: string;
  is_entry: boolean;
  is_terminal: boolean;
  is_optional: boolean;
  retry_max_attempts: number;
  retry_backoff_seconds: number;
  retry_backoff_multiplier: number;
  execution_priority: number;
}
