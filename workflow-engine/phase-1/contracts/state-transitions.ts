/*
 * Phase 1 transition constants for durable workflow orchestration.
 * Contract-only module: no runtime behavior.
 */

export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

export type ActivityRunStatus =
  | "pending"
  | "queued"
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled"
  | "waiting_retry";

export const TERMINAL_WORKFLOW_STATUSES: readonly WorkflowRunStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "timed_out",
] as const;

export const TERMINAL_ACTIVITY_STATUSES: readonly ActivityRunStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "skipped",
] as const;

export const WORKFLOW_ALLOWED_TRANSITIONS: Readonly<Record<WorkflowRunStatus, readonly WorkflowRunStatus[]>> = {
  pending: ["running", "cancelled", "timed_out"],
  running: ["completed", "failed", "cancelled", "timed_out"],
  completed: [],
  failed: [],
  cancelled: [],
  timed_out: [],
} as const;

export const ACTIVITY_ALLOWED_TRANSITIONS: Readonly<Record<ActivityRunStatus, readonly ActivityRunStatus[]>> = {
  pending: ["queued", "cancelled"],
  queued: ["claimed", "cancelled"],
  claimed: ["running", "queued", "cancelled"],
  running: ["completed", "waiting_retry", "failed", "cancelled"],
  waiting_retry: ["queued", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
  skipped: [],
} as const;

export const MVP_ACTIVITY_BEHAVIOR = {
  skipped_supported: false,
  skipped_reason:
    "Skipped is reserved for future branch/condition semantics and is not produced in MVP execution.",
  lease_expiry_behavior:
    "A claimed activity may be requeued when lease expires before completion.",
  retry_behavior:
    "Retryable failures move running -> waiting_retry, then scheduler promotes waiting_retry -> queued.",
} as const;
