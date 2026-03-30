// @ts-nocheck
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import type { JsonValue } from "./contracts.ts";
import {
  failActivityRun,
  failWorkflowForRequiredActivity,
  finalizeWorkflowIfComplete,
} from "./orchestration-helpers.ts";
import {
  decideStaleRecovery,
  type StaleActivityRunSnapshot,
  type StaleRecoveryAction,
} from "./stale-work-policy.ts";

export interface RecoverStaleActivityRunsRequest {
  max_records?: number;
  stale_before_seconds?: number;
  dry_run?: boolean;
  actor?: string;
}

export interface RecoverStaleActivityRunsResponse {
  scanned_count: number;
  stale_found_count: number;
  recovered_to_queued_count: number;
  recovered_to_waiting_retry_count: number;
  failed_count: number;
  workflow_run_ids_touched: string[];
  activity_run_ids_touched: string[];
  dry_run: boolean;
  message: string;
}

interface ActivityAttemptRow {
  id: string;
  attempt_number: number;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  error_details: JsonValue | null;
  error_message: string | null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  const rounded = Math.floor(num);
  return Math.min(Math.max(rounded, min), max);
}

function toObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function buildRecoveryDetails(
  snapshot: StaleActivityRunSnapshot,
  action: StaleRecoveryAction,
  reason: string,
  actor: string,
  staleCutoffIso: string
): Record<string, unknown> {
  return {
    recovery_reason: reason,
    recovery_action: action,
    previous_status: snapshot.status,
    previous_claimed_by: snapshot.claimed_by ?? null,
    previous_claimed_at: snapshot.claimed_at ?? null,
    previous_started_at: snapshot.started_at ?? null,
    previous_lease_expires_at: snapshot.lease_expires_at ?? null,
    attempt_number: snapshot.attempt_count,
    max_attempts: snapshot.max_attempts,
    stale_cutoff_iso: staleCutoffIso,
    actor,
    source: "phase7_lease_recovery",
  };
}

async function fetchLatestAttemptForRecovery(
  supabase: SupabaseClient,
  activityRunId: string,
  attemptNumber: number
): Promise<ActivityAttemptRow | null> {
  const { data: exactAttempt, error: exactAttemptError } = await supabase
    .from("activity_attempts")
    .select(
      "id, attempt_number, claimed_at, started_at, finished_at, error_details, error_message"
    )
    .eq("activity_run_id", activityRunId)
    .eq("attempt_number", attemptNumber)
    .maybeSingle();

  if (exactAttemptError) {
    console.warn(
      `Failed to load exact activity_attempt ${attemptNumber} for ${activityRunId}: ${exactAttemptError.message}`
    );
    return null;
  }

  if (exactAttempt) {
    return exactAttempt as ActivityAttemptRow;
  }

  const { data: fallbackAttempt, error: fallbackError } = await supabase
    .from("activity_attempts")
    .select(
      "id, attempt_number, claimed_at, started_at, finished_at, error_details, error_message"
    )
    .eq("activity_run_id", activityRunId)
    .is("finished_at", null)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fallbackError) {
    console.warn(
      `Failed to load fallback unfinished attempt for ${activityRunId}: ${fallbackError.message}`
    );
    return null;
  }

  return fallbackAttempt ? (fallbackAttempt as ActivityAttemptRow) : null;
}

async function closeAbandonedAttemptIfPresent(
  supabase: SupabaseClient,
  snapshot: StaleActivityRunSnapshot,
  recoveryMessage: string,
  recoveryDetails: Record<string, unknown>,
  nowIso: string
): Promise<void> {
  const attempt = await fetchLatestAttemptForRecovery(
    supabase,
    snapshot.id,
    Math.max(1, Number(snapshot.attempt_count ?? 1))
  );

  if (!attempt) {
    return;
  }

  if (attempt.finished_at) {
    return;
  }

  const startedIso =
    attempt.started_at ??
    snapshot.started_at ??
    attempt.claimed_at ??
    snapshot.claimed_at ??
    null;

  const durationMs = startedIso
    ? Math.max(0, new Date(nowIso).getTime() - new Date(startedIso).getTime())
    : null;

  const mergedErrorDetails = {
    ...toObject(attempt.error_details),
    ...recoveryDetails,
  };

  const { error } = await supabase
    .from("activity_attempts")
    .update({
      finished_at: nowIso,
      error_message: attempt.error_message ?? recoveryMessage,
      error_details: mergedErrorDetails,
      duration_ms: durationMs,
    })
    .eq("id", attempt.id)
    .is("finished_at", null);

  if (error) {
    console.warn(
      `Failed to close abandoned attempt ${attempt.id} for ${snapshot.id}: ${error.message}`
    );
  }
}

async function writeRecoveryRetryingEvent(
  supabase: SupabaseClient,
  workflowRunId: string,
  activityRunId: string,
  details: Record<string, unknown>,
  actor: string
): Promise<void> {
  const { error } = await supabase.from("workflow_events").insert({
    workflow_run_id: workflowRunId,
    activity_run_id: activityRunId,
    event_type: "activity_retrying",
    actor,
    details,
  });

  if (error) {
    console.warn(
      `Failed to write recovery activity_retrying event for ${activityRunId}: ${error.message}`
    );
  }
}

async function isStillStale(
  supabase: SupabaseClient,
  activityRunId: string,
  expectedStatus: "claimed" | "running",
  staleCutoffIso: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("activity_runs")
    .select("status, lease_expires_at")
    .eq("id", activityRunId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed stale re-check for ${activityRunId}: ${error.message}`);
  }

  if (!data) {
    return false;
  }

  if (data.status !== expectedStatus) {
    return false;
  }

  if (!data.lease_expires_at) {
    return false;
  }

  return new Date(data.lease_expires_at).getTime() <= new Date(staleCutoffIso).getTime();
}

async function recoverStaleClaimedToQueued(
  supabase: SupabaseClient,
  snapshot: StaleActivityRunSnapshot,
  staleCutoffIso: string,
  actor: string
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const recoveryMessage = "Recovered stale claimed activity after lease expiry";
  const recoveryDetails = buildRecoveryDetails(
    snapshot,
    "recover_to_queued",
    "stale_claimed_lease_expired",
    actor,
    staleCutoffIso
  );

  const { data: updatedRows, error: updateError } = await supabase
    .from("activity_runs")
    .update({
      status: "queued",
      error_message: recoveryMessage,
      error_details: recoveryDetails,
      next_retry_at: null,
      started_at: null,
      finished_at: null,
      claimed_by: null,
      claimed_at: null,
      lease_expires_at: null,
      scheduled_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", snapshot.id)
    .eq("status", "claimed")
    .lte("lease_expires_at", staleCutoffIso)
    .select("id");

  if (updateError) {
    throw new Error(
      `Failed to recover stale claimed activity ${snapshot.id}: ${updateError.message}`
    );
  }

  const changed = Array.isArray(updatedRows) && updatedRows.length > 0;
  if (!changed) {
    return false;
  }

  await closeAbandonedAttemptIfPresent(
    supabase,
    snapshot,
    recoveryMessage,
    recoveryDetails,
    nowIso
  );

  await writeRecoveryRetryingEvent(
    supabase,
    snapshot.workflow_run_id,
    snapshot.id,
    {
      ...recoveryDetails,
      reason: "lease_expired_recovery",
    },
    actor
  );

  return true;
}

async function applyTerminalFailureWorkflowPolicy(
  supabase: SupabaseClient,
  snapshot: StaleActivityRunSnapshot,
  recoveryDetails: Record<string, unknown>
): Promise<void> {
  if (!snapshot.is_optional) {
    await failWorkflowForRequiredActivity(
      supabase,
      snapshot.workflow_run_id,
      snapshot.id,
      "required_activity_terminal_failure",
      recoveryDetails
    );
  } else {
    await finalizeWorkflowIfComplete(supabase, snapshot.workflow_run_id);
  }
}

async function recoverStaleRunningOrTerminal(
  supabase: SupabaseClient,
  snapshot: StaleActivityRunSnapshot,
  actor: string,
  staleCutoffIso: string,
  forceTerminal: boolean
): Promise<"waiting_retry" | "failed"> {
  const nowIso = new Date().toISOString();

  const recoveryAction = forceTerminal ? "fail_terminal" : "recover_to_waiting_retry";
  const recoveryReason = forceTerminal
    ? "retry_budget_exhausted"
    : "stale_running_lease_expired";

  const recoveryMessage = forceTerminal
    ? "Stale running activity exceeded retry budget and was marked terminal"
    : "Stale running activity recovered to waiting_retry after lease expiry";

  const recoveryDetails = buildRecoveryDetails(
    snapshot,
    recoveryAction,
    recoveryReason,
    actor,
    staleCutoffIso
  );

  const willRetry = await failActivityRun(
    supabase,
    snapshot.id,
    snapshot.workflow_run_id,
    Math.max(1, Number(snapshot.attempt_count ?? 1)),
    snapshot.max_attempts,
    snapshot.retry_backoff_seconds,
    snapshot.retry_backoff_multiplier,
    recoveryMessage,
    !forceTerminal,
    {
      ...recoveryDetails,
      classification: forceTerminal ? "terminal" : "retryable",
      category: "external_timeout",
    }
  );

  await closeAbandonedAttemptIfPresent(
    supabase,
    snapshot,
    recoveryMessage,
    recoveryDetails,
    nowIso
  );

  if (!willRetry) {
    await applyTerminalFailureWorkflowPolicy(
      supabase,
      snapshot,
      recoveryDetails
    );
    return "failed";
  }

  return "waiting_retry";
}

async function recoverStaleClaimedOrTerminal(
  supabase: SupabaseClient,
  snapshot: StaleActivityRunSnapshot,
  staleCutoffIso: string,
  actor: string,
  forceTerminal: boolean
): Promise<"queued" | "failed" | "skipped"> {
  if (!forceTerminal) {
    const changed = await recoverStaleClaimedToQueued(
      supabase,
      snapshot,
      staleCutoffIso,
      actor
    );
    return changed ? "queued" : "skipped";
  }

  const nowIso = new Date().toISOString();
  const recoveryMessage =
    "Stale claimed activity exceeded retry budget and was marked terminal";
  const recoveryDetails = buildRecoveryDetails(
    snapshot,
    "fail_terminal",
    "retry_budget_exhausted",
    actor,
    staleCutoffIso
  );

  await failActivityRun(
    supabase,
    snapshot.id,
    snapshot.workflow_run_id,
    Math.max(1, Number(snapshot.attempt_count ?? 1)),
    snapshot.max_attempts,
    snapshot.retry_backoff_seconds,
    snapshot.retry_backoff_multiplier,
    recoveryMessage,
    false,
    {
      ...recoveryDetails,
      classification: "terminal",
      category: "external_timeout",
    }
  );

  await closeAbandonedAttemptIfPresent(
    supabase,
    snapshot,
    recoveryMessage,
    recoveryDetails,
    nowIso
  );

  await applyTerminalFailureWorkflowPolicy(
    supabase,
    snapshot,
    recoveryDetails
  );

  return "failed";
}

export async function recoverStaleActivityRuns(
  supabase: SupabaseClient,
  request: RecoverStaleActivityRunsRequest = {}
): Promise<RecoverStaleActivityRunsResponse> {
  const maxRecords = clampInt(request.max_records, 1, 500, 50);
  const staleBeforeSeconds = clampInt(request.stale_before_seconds, 0, 86400, 0);
  const dryRun = request.dry_run === true;
  const actor = request.actor?.trim() || "maintenance";

  const staleCutoffIso = new Date(Date.now() - staleBeforeSeconds * 1000).toISOString();

  const { data: staleRows, error: staleError } = await supabase
    .from("activity_runs")
    .select(
      "id, workflow_run_id, activity_key, status, attempt_count, max_attempts, retry_backoff_seconds, retry_backoff_multiplier, is_optional, claimed_by, claimed_at, started_at, lease_expires_at"
    )
    .in("status", ["claimed", "running"])
    .not("lease_expires_at", "is", null)
    .lte("lease_expires_at", staleCutoffIso)
    .order("lease_expires_at", { ascending: true })
    .limit(maxRecords);

  if (staleError) {
    throw new Error(`Failed to query stale activity runs: ${staleError.message}`);
  }

  const stale = (staleRows ?? []) as StaleActivityRunSnapshot[];

  const workflowIds = new Set<string>();
  const activityIds = new Set<string>();

  let recoveredToQueuedCount = 0;
  let recoveredToWaitingRetryCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const snapshot of stale) {
    const decision = decideStaleRecovery(snapshot);

    workflowIds.add(snapshot.workflow_run_id);
    activityIds.add(snapshot.id);

    if (dryRun) {
      if (decision.action === "recover_to_queued") {
        recoveredToQueuedCount += 1;
      } else if (decision.action === "recover_to_waiting_retry") {
        recoveredToWaitingRetryCount += 1;
      } else {
        failedCount += 1;
      }
      continue;
    }

    const stillStale = await isStillStale(
      supabase,
      snapshot.id,
      snapshot.status,
      staleCutoffIso
    );

    if (!stillStale) {
      skippedCount += 1;
      continue;
    }

    if (snapshot.status === "claimed") {
      const result = await recoverStaleClaimedOrTerminal(
        supabase,
        snapshot,
        staleCutoffIso,
        actor,
        decision.action === "fail_terminal"
      );

      if (result === "queued") {
        recoveredToQueuedCount += 1;
      } else if (result === "failed") {
        failedCount += 1;
      } else {
        skippedCount += 1;
      }
      continue;
    }

    const runningResult = await recoverStaleRunningOrTerminal(
      supabase,
      snapshot,
      actor,
      staleCutoffIso,
      decision.action === "fail_terminal"
    );

    if (runningResult === "waiting_retry") {
      recoveredToWaitingRetryCount += 1;
    } else {
      failedCount += 1;
    }
  }

  const message = dryRun
    ? `Dry run complete: ${stale.length} stale activities classified`
    : `Recovery complete: ${recoveredToQueuedCount} queued, ${recoveredToWaitingRetryCount} waiting_retry, ${failedCount} failed${skippedCount > 0 ? `, ${skippedCount} skipped (race)` : ""}`;

  return {
    scanned_count: stale.length,
    stale_found_count: stale.length,
    recovered_to_queued_count: recoveredToQueuedCount,
    recovered_to_waiting_retry_count: recoveredToWaitingRetryCount,
    failed_count: failedCount,
    workflow_run_ids_touched: Array.from(workflowIds),
    activity_run_ids_touched: Array.from(activityIds),
    dry_run: dryRun,
    message,
  };
}
