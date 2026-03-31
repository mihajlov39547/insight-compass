// @ts-nocheck
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import type { JsonObject, JsonValue } from "./contracts.ts";
import { computeNextRetrySchedule } from "./retry-policy.ts";
import { finalizeWorkflowRunState } from "./workflow-finalization.ts";

const CONTEXT_PATCH_MAX_KEYS = 24;
const CONTEXT_PATCH_MAX_BYTES = 8 * 1024;
const WORKFLOW_CONTEXT_MAX_BYTES = 64 * 1024;
const CONTEXT_PATCH_MAX_STRING_LENGTH = 1000;
const CONTEXT_PATCH_UPDATE_MAX_RETRIES = 5;

function toObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function isSafeContextPrimitive(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= CONTEXT_PATCH_MAX_STRING_LENGTH;
  return false;
}

// Keep context patches lightweight by allowing only primitives or shallow objects with primitive values.
function sanitizeContextPatch(rawPatch: JsonObject): JsonObject {
  const entries = Object.entries(rawPatch).slice(0, CONTEXT_PATCH_MAX_KEYS);
  const sanitized: JsonObject = {};

  for (const [key, value] of entries) {
    if (isSafeContextPrimitive(value)) {
      sanitized[key] = value as JsonValue;
      continue;
    }

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const nestedObject = value as Record<string, unknown>;
      const nestedEntries = Object.entries(nestedObject).slice(0, CONTEXT_PATCH_MAX_KEYS);
      const nestedSanitized: JsonObject = {};

      for (const [nestedKey, nestedValue] of nestedEntries) {
        if (isSafeContextPrimitive(nestedValue)) {
          nestedSanitized[nestedKey] = nestedValue as JsonValue;
        }
      }

      if (Object.keys(nestedSanitized).length > 0) {
        sanitized[key] = nestedSanitized;
      }
    }
  }

  return sanitized;
}

export interface ContextPatchApplySummary {
  applied: boolean;
  workflow_run_id: string;
  activity_run_id: string;
  patch_keys: string[];
  merge_policy: "shallow_top_level_lww";
  reason?: string;
  attempts?: number;
  previous_context_size?: number;
  new_context_size?: number;
  patch_size?: number;
}

/**
 * Orchestrator-owned context patch application.
 * Merge policy: shallow top-level object merge, last write wins by completion order.
 */
export async function applyWorkflowContextPatch(
  supabase: SupabaseClient,
  workflowRunId: string,
  activityRunId: string,
  contextPatch: JsonObject | undefined,
  actor: string = "worker"
): Promise<ContextPatchApplySummary> {
  const emptySummary: ContextPatchApplySummary = {
    applied: false,
    workflow_run_id: workflowRunId,
    activity_run_id: activityRunId,
    patch_keys: [],
    merge_policy: "shallow_top_level_lww",
  };

  if (!contextPatch || typeof contextPatch !== "object" || Array.isArray(contextPatch)) {
    return {
      ...emptySummary,
      reason: "no_context_patch",
    };
  }

  const sanitizedPatch = sanitizeContextPatch(contextPatch);
  const patchKeys = Object.keys(sanitizedPatch);

  if (patchKeys.length === 0) {
    return {
      ...emptySummary,
      reason: "context_patch_empty_after_sanitization",
    };
  }

  const patchSize = JSON.stringify(sanitizedPatch).length;
  if (patchSize > CONTEXT_PATCH_MAX_BYTES) {
    return {
      ...emptySummary,
      patch_keys: patchKeys,
      patch_size: patchSize,
      reason: "context_patch_too_large",
    };
  }

  for (let attempt = 1; attempt <= CONTEXT_PATCH_UPDATE_MAX_RETRIES; attempt++) {
    const { data: row, error: rowError } = await supabase
      .from("workflow_runs")
      .select("context, updated_at")
      .eq("id", workflowRunId)
      .single();

    if (rowError || !row) {
      throw new Error(
        `Failed to load workflow context for patch merge: ${rowError?.message ?? "not found"}`
      );
    }

    const existingContext = toObject(row.context);
    const previousContextSize = JSON.stringify(existingContext).length;

    const mergedContext: JsonObject = {
      ...existingContext,
      ...sanitizedPatch,
    };

    const newContextSize = JSON.stringify(mergedContext).length;
    if (newContextSize > WORKFLOW_CONTEXT_MAX_BYTES) {
      return {
        ...emptySummary,
        patch_keys: patchKeys,
        patch_size: patchSize,
        previous_context_size: previousContextSize,
        new_context_size: newContextSize,
        reason: "workflow_context_size_limit_exceeded",
      };
    }

    const nowIso = new Date().toISOString();
    const { data: updatedRows, error: updateError } = await supabase
      .from("workflow_runs")
      .update({
        context: mergedContext,
        updated_at: nowIso,
      })
      .eq("id", workflowRunId)
      .eq("updated_at", row.updated_at)
      .select("id");

    if (updateError) {
      throw new Error(`Failed to apply workflow context patch: ${updateError.message}`);
    }

    const changed = Array.isArray(updatedRows) && updatedRows.length > 0;
    if (!changed) {
      continue;
    }

    const { error: eventError } = await supabase
      .from("workflow_events")
      .insert({
        workflow_run_id: workflowRunId,
        activity_run_id: activityRunId,
        event_type: "workflow_context_patched",
        actor,
        details: {
          merge_policy: "shallow_top_level_lww",
          patch_keys: patchKeys,
          patch_size: patchSize,
          previous_context_size: previousContextSize,
          new_context_size: newContextSize,
          merge_attempt: attempt,
        },
      });

    if (eventError) {
      console.warn(`Failed to write workflow_context_patched event: ${eventError.message}`);
    }

    return {
      applied: true,
      workflow_run_id: workflowRunId,
      activity_run_id: activityRunId,
      patch_keys: patchKeys,
      patch_size: patchSize,
      previous_context_size: previousContextSize,
      new_context_size: newContextSize,
      attempts: attempt,
      merge_policy: "shallow_top_level_lww",
    };
  }

  return {
    ...emptySummary,
    patch_keys: patchKeys,
    patch_size: patchSize,
    attempts: CONTEXT_PATCH_UPDATE_MAX_RETRIES,
    reason: "context_patch_merge_concurrency_retries_exhausted",
  };
}

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
