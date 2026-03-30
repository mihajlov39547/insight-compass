import { computeNextRetrySchedule } from "./retry-policy.ts";

/**
 * Phase 7 MVP stale-work policy.
 *
 * Authoritative stale signal:
 * - lease_expires_at has passed (optionally with stale_before_seconds grace).
 *
 * Heartbeats:
 * - Not actively maintained in Phase 7.
 * - Recovery decisions intentionally do NOT depend on heartbeat freshness yet.
 */
export const STALE_WORK_POLICY = {
  stale_statuses: ["claimed", "running"] as const,
  authoritative_signal: "lease_expired",
  heartbeat_mode: "deferred",
  claimed_recovery_default: "recover_to_queued",
  running_recovery_default: "recover_to_waiting_retry",
} as const;

export type StaleRecoveryAction =
  | "recover_to_queued"
  | "recover_to_waiting_retry"
  | "fail_terminal";

export interface StaleActivityRunSnapshot {
  id: string;
  workflow_run_id: string;
  activity_key: string;
  status: "claimed" | "running";
  attempt_count: number;
  max_attempts: number;
  retry_backoff_seconds: number;
  retry_backoff_multiplier: number;
  is_optional: boolean;
  claimed_by?: string | null;
  claimed_at?: string | null;
  started_at?: string | null;
  lease_expires_at?: string | null;
}

export interface StaleRecoveryDecision {
  action: StaleRecoveryAction;
  attempts_remaining: boolean;
  retry_budget_remaining: number;
  attempt_number: number;
  reason: string;
}

export function decideStaleRecovery(
  snapshot: StaleActivityRunSnapshot
): StaleRecoveryDecision {
  const attemptNumber = Math.max(1, Number(snapshot.attempt_count ?? 1));
  const maxAttempts = Math.max(1, Number(snapshot.max_attempts ?? 1));

  const retrySchedule = computeNextRetrySchedule({
    attemptNumber,
    maxAttempts,
    retryBackoffSeconds: snapshot.retry_backoff_seconds,
    retryBackoffMultiplier: snapshot.retry_backoff_multiplier,
  });

  const retryBudgetRemaining = Math.max(maxAttempts - attemptNumber, 0);

  if (!retrySchedule.attemptsRemaining) {
    return {
      action: "fail_terminal",
      attempts_remaining: false,
      retry_budget_remaining: retryBudgetRemaining,
      attempt_number: attemptNumber,
      reason: "retry_budget_exhausted",
    };
  }

  if (snapshot.status === "claimed") {
    return {
      action: "recover_to_queued",
      attempts_remaining: true,
      retry_budget_remaining: retryBudgetRemaining,
      attempt_number: attemptNumber,
      reason: "stale_claimed_lease_expired",
    };
  }

  return {
    action: "recover_to_waiting_retry",
    attempts_remaining: true,
    retry_budget_remaining: retryBudgetRemaining,
    attempt_number: attemptNumber,
    reason: "stale_running_lease_expired",
  };
}
