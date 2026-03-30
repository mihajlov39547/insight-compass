// @ts-nocheck
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import type { ActivityExecutionContext } from "./contracts.ts";

export async function loadActivityExecutionContext(
  supabase: SupabaseClient,
  activityRunId: string
): Promise<ActivityExecutionContext> {
  const { data: activityRun, error: activityRunError } = await supabase
    .from("activity_runs")
    .select(
      "id, workflow_run_id, activity_id, activity_key, activity_name, handler_key, status, attempt_count, max_attempts, is_optional, is_terminal, input_payload, retry_backoff_seconds, retry_backoff_multiplier, version_id"
    )
    .eq("id", activityRunId)
    .single();

  if (activityRunError || !activityRun) {
    throw new Error(
      `Failed to load activity_run ${activityRunId}: ${activityRunError?.message ?? "not found"}`
    );
  }

  const { data: workflowRun, error: workflowRunError } = await supabase
    .from("workflow_runs")
    .select(
      "id, workflow_definition_id, version_id, status, context, input_payload"
    )
    .eq("id", activityRun.workflow_run_id)
    .single();

  if (workflowRunError || !workflowRun) {
    throw new Error(
      `Failed to load workflow_run ${activityRun.workflow_run_id}: ${workflowRunError?.message ?? "not found"}`
    );
  }

  return {
    activity_run: activityRun,
    workflow_run: workflowRun,
  };
}

export async function createActivityAttempt(
  supabase: SupabaseClient,
  activityRunId: string,
  workflowRunId: string,
  attemptNumber: number,
  claimedBy: string,
  inputPayload: unknown
): Promise<string> {
  const { data, error } = await supabase
    .from("activity_attempts")
    .insert({
      activity_run_id: activityRunId,
      workflow_run_id: workflowRunId,
      attempt_number: attemptNumber,
      claimed_by: claimedBy,
      claimed_at: new Date().toISOString(),
      input_payload: inputPayload,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to create activity_attempt: ${error?.message ?? "unknown error"}`
    );
  }

  return data.id;
}

export async function updateActivityAttemptOnStart(
  supabase: SupabaseClient,
  attemptId: string,
  startedAt: string
): Promise<void> {
  const { error } = await supabase
    .from("activity_attempts")
    .update({
      started_at: startedAt,
    })
    .eq("id", attemptId);

  if (error) {
    console.warn(
      `Failed to update activity_attempt on start: ${error.message}`
    );
  }
}

export async function updateActivityAttemptOnFinish(
  supabase: SupabaseClient,
  attemptId: string,
  finishedAt: string,
  outputPayload?: unknown,
  errorMessage?: string,
  errorDetails?: unknown,
  startedAt?: string
): Promise<void> {
  const durationMs = startedAt
    ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
    : null;

  const { error } = await supabase
    .from("activity_attempts")
    .update({
      finished_at: finishedAt,
      output_payload: outputPayload ?? null,
      error_message: errorMessage ?? null,
      error_details: errorDetails ?? null,
      duration_ms: durationMs,
    })
    .eq("id", attemptId);

  if (error) {
    console.warn(
      `Failed to update activity_attempt on finish: ${error.message}`
    );
  }
}
