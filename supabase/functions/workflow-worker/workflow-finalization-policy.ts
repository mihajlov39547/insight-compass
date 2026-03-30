export const WORKFLOW_TERMINAL_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "timed_out",
] as const;

export const ACTIVITY_IN_PROGRESS_STATUSES = [
  "pending",
  "queued",
  "claimed",
  "running",
  "waiting_retry",
] as const;

export const REQUIRED_ACTIVITY_FAILURE_STATUSES = [
  "failed",
  "cancelled",
] as const;

/**
 * Phase 8 MVP workflow finalization policy.
 *
 * 1) Keep workflow running when any activity is still in-progress.
 * 2) Fail workflow when any required activity is terminal failed/cancelled.
 * 3) Complete workflow when no in-progress activities remain and no required
 *    failed/cancelled activity exists.
 *
 * Notes:
 * - This policy is aggregate runtime-state based. is_terminal on definition
 *   activities does not add special completion semantics in MVP.
 * - workflow cancellation/timed_out transitions are reserved for control-plane
 *   flows and are not produced by this finalizer.
 */
export const WORKFLOW_FINALIZATION_POLICY = {
  in_progress_statuses: ACTIVITY_IN_PROGRESS_STATUSES,
  required_failure_statuses: REQUIRED_ACTIVITY_FAILURE_STATUSES,
  terminal_workflow_statuses: WORKFLOW_TERMINAL_STATUSES,
  mode: "aggregate_runtime_state_mvp",
} as const;
