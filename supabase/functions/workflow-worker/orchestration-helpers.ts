// @ts-nocheck
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import type { JsonValue } from "./contracts.ts";
import { computeNextRetrySchedule } from "./retry-policy.ts";
import { finalizeWorkflowRunState } from "./workflow-finalization.ts";

export async function completeActivityRun(
  supabase: SupabaseClient,
  activityRunId: string,
  workflowRunId: string,
  outputPayload: JsonValue
): Promise<void> {
  const nowIso = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("activity_runs")
    .update({
      status: "completed",
      output_payload: outputPayload,
      error_message: null,
      error_details: null,
      next_retry_at: null,
      finished_at: nowIso,
      claimed_by: null,
      lease_expires_at: null,
      updated_at: nowIso,
    })
    .eq("id", activityRunId);

  if (updateError) {
    throw new Error(`Failed to complete activity_run: ${updateError.message}`);
  }

  // Write activity_completed event
  const { error: eventError } = await supabase
    .from("workflow_events")
    .insert({
      workflow_run_id: workflowRunId,
      activity_run_id: activityRunId,
      event_type: "activity_completed",
      actor: "worker",
      details: {
        completed_at: nowIso,
      },
    });

  if (eventError) {
    console.warn(
      `Failed to write activity_completed event: ${eventError.message}`
    );
  }

  // Write activity_output_written event if payload is non-null
  if (outputPayload !== null && outputPayload !== undefined) {
    const { error: outputEventError } = await supabase
      .from("workflow_events")
      .insert({
        workflow_run_id: workflowRunId,
        activity_run_id: activityRunId,
        event_type: "activity_output_written",
        actor: "worker",
        details: {
          output_size: JSON.stringify(outputPayload).length,
        },
      });

    if (outputEventError) {
      console.warn(
        `Failed to write activity_output_written event: ${outputEventError.message}`
      );
    }
  }
}

export async function failActivityRun(
  supabase: SupabaseClient,
  activityRunId: string,
  workflowRunId: string,
  attemptNumber: number,
  maxAttempts: number,
  retryBackoffSeconds: number,
  retryBackoffMultiplier: number,
  errorMessage: string,
  isRetryable: boolean,
  errorDetails?: JsonValue
): Promise<boolean> {
  // isRetryable and attempts remain => waiting_retry
  // otherwise => failed
  const nowIso = new Date().toISOString();

  const retrySchedule = computeNextRetrySchedule({
    attemptNumber,
    maxAttempts,
    retryBackoffSeconds,
    retryBackoffMultiplier,
  });

  const shouldRetry = isRetryable && retrySchedule.attemptsRemaining;

  let status: string;
  let nextRetryAt: string | null = null;

  if (shouldRetry) {
    status = "waiting_retry";
    nextRetryAt = retrySchedule.nextRetryAt;
  } else {
    status = "failed";
  }

  const { error: updateError } = await supabase
    .from("activity_runs")
    .update({
      status,
      error_message: errorMessage,
      error_details: errorDetails ?? null,
      next_retry_at: nextRetryAt,
      finished_at: shouldRetry ? null : nowIso,
      claimed_by: null,
      lease_expires_at: null,
      updated_at: nowIso,
    })
    .eq("id", activityRunId);

  if (updateError) {
    throw new Error(`Failed to fail activity_run: ${updateError.message}`);
  }

  // Write activity_failed event
  const { error: failedEventError } = await supabase
    .from("workflow_events")
    .insert({
      workflow_run_id: workflowRunId,
      activity_run_id: activityRunId,
      event_type: "activity_failed",
      actor: "worker",
      details: {
        error_message: errorMessage,
        error_details: errorDetails ?? null,
        attempt_number: attemptNumber,
        max_attempts: maxAttempts,
        classification: shouldRetry ? "retryable" : "terminal",
        is_terminal: !shouldRetry,
      },
    });

  if (failedEventError) {
    console.warn(
      `Failed to write activity_failed event: ${failedEventError.message}`
    );
  }

  // If retrying, write activity_retrying event
  if (shouldRetry) {
    const { error: retryingEventError } = await supabase
      .from("workflow_events")
      .insert({
        workflow_run_id: workflowRunId,
        activity_run_id: activityRunId,
        event_type: "activity_retrying",
        actor: "worker",
        details: {
          next_retry_at: nextRetryAt,
          delay_seconds: retrySchedule.delaySeconds,
          attempt_number: attemptNumber,
        },
      });

    if (retryingEventError) {
      console.warn(
        `Failed to write activity_retrying event: ${retryingEventError.message}`
      );
    }
  }

  return shouldRetry;
}

export async function failWorkflowForRequiredActivity(
  supabase: SupabaseClient,
  workflowRunId: string,
  activityRunId: string,
  reason: string,
  details?: JsonValue
): Promise<boolean> {
  const triggerDetails =
    details && typeof details === "object" && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : { details: details ?? null };

  const summary = await finalizeWorkflowRunState(supabase, workflowRunId, {
    actor: "worker",
    activity_run_id: activityRunId,
    reason,
    details: triggerDetails,
  });

  return summary.action === "finalized_failed";
}

export async function finalizeWorkflowIfComplete(
  supabase: SupabaseClient,
  workflowRunId: string
): Promise<boolean> {
  const summary = await finalizeWorkflowRunState(supabase, workflowRunId, {
    actor: "worker",
  });

  return ["completed", "failed", "cancelled", "timed_out"].includes(
    summary.final_status
  );
}
