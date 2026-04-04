// @ts-nocheck
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  WORKFLOW_FINALIZATION_POLICY,
  WORKFLOW_TERMINAL_STATUSES,
} from "./workflow-finalization-policy.ts";
import { buildWorkflowFinalOutput } from "./final-output-builder.ts";

interface ActivityRunForFinalization {
  id: string;
  activity_id: string;
  activity_key: string;
  status: string;
  is_optional: boolean;
  output_payload: unknown;
  error_message: string | null;
}

export interface FinalizationTrigger {
  actor?: string;
  activity_run_id?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface WorkflowFinalizationSummary {
  workflow_run_id: string;
  previous_status: string;
  final_status: string;
  action:
    | "already_terminal"
    | "still_running"
    | "finalized_completed"
    | "finalized_failed"
    | "concurrent_terminal";
  in_progress_count: number;
  required_failure_count: number;
  completed_activity_count: number;
  failed_activity_count: number;
  cancelled_activity_count: number;
  optional_failure_count: number;
  message: string;
}

function statusIn(value: string, allowed: readonly string[]): boolean {
  return allowed.includes(value);
}

function summarizeActivityState(activityRuns: ActivityRunForFinalization[]) {
  const inProgressCount = activityRuns.filter((row) =>
    statusIn(row.status, WORKFLOW_FINALIZATION_POLICY.in_progress_statuses)
  ).length;

  const requiredFailureCount = activityRuns.filter(
    (row) =>
      !row.is_optional &&
      statusIn(row.status, WORKFLOW_FINALIZATION_POLICY.required_failure_statuses)
  ).length;

  const completedCount = activityRuns.filter((row) => row.status === "completed").length;
  const failedCount = activityRuns.filter((row) => row.status === "failed").length;
  const cancelledCount = activityRuns.filter((row) => row.status === "cancelled").length;
  const optionalFailureCount = activityRuns.filter(
    (row) => row.is_optional && ["failed", "cancelled"].includes(row.status)
  ).length;

  return {
    inProgressCount,
    requiredFailureCount,
    completedCount,
    failedCount,
    cancelledCount,
    optionalFailureCount,
  };
}

async function loadWorkflowStatus(
  supabase: SupabaseClient,
  workflowRunId: string
): Promise<string> {
  const { data, error } = await supabase
    .from("workflow_runs")
    .select("status")
    .eq("id", workflowRunId)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to load workflow run ${workflowRunId}: ${error?.message ?? "not found"}`
    );
  }

  return data.status;
}

async function loadActivityRuns(
  supabase: SupabaseClient,
  workflowRunId: string
): Promise<ActivityRunForFinalization[]> {
  const { data, error } = await supabase
    .from("activity_runs")
    .select("id, activity_id, activity_key, status, is_optional, output_payload, error_message")
    .eq("workflow_run_id", workflowRunId);

  if (error || !data) {
    throw new Error(
      `Failed to load activity runs for ${workflowRunId}: ${error?.message ?? "not found"}`
    );
  }

  return data as ActivityRunForFinalization[];
}

async function loadReachableActivityIds(
  supabase: SupabaseClient,
  workflowRunId: string
): Promise<Set<string>> {
  try {
    const { data, error } = await supabase.rpc("workflow_reachable_activity_ids", {
      p_workflow_run_id: workflowRunId,
    });

    if (error || !Array.isArray(data)) {
      return new Set<string>();
    }

    const ids = new Set<string>();
    for (const row of data as Array<Record<string, unknown>>) {
      const id = typeof row.activity_id === "string" ? row.activity_id : null;
      if (id) ids.add(id);
    }

    return ids;
  } catch {
    return new Set<string>();
  }
}

function inferFailedReason(
  requiredFailureCount: number,
  trigger: FinalizationTrigger
): string {
  if (trigger.reason && trigger.reason.trim()) {
    return trigger.reason;
  }

  if (requiredFailureCount > 0) {
    return "required_activity_failed_or_cancelled";
  }

  return "workflow_failed";
}

export async function finalizeWorkflowRunState(
  supabase: SupabaseClient,
  workflowRunId: string,
  trigger: FinalizationTrigger = {}
): Promise<WorkflowFinalizationSummary> {
  const actor = trigger.actor?.trim() || "worker";

  const previousStatus = await loadWorkflowStatus(supabase, workflowRunId);

  if (statusIn(previousStatus, WORKFLOW_TERMINAL_STATUSES)) {
    return {
      workflow_run_id: workflowRunId,
      previous_status: previousStatus,
      final_status: previousStatus,
      action: "already_terminal",
      in_progress_count: 0,
      required_failure_count: 0,
      completed_activity_count: 0,
      failed_activity_count: 0,
      cancelled_activity_count: 0,
      optional_failure_count: 0,
      message: "Workflow already terminal; no mutation performed",
    };
  }

  const activityRuns = await loadActivityRuns(supabase, workflowRunId);
  const reachableActivityIds = await loadReachableActivityIds(supabase, workflowRunId);
  const relevantRuns = reachableActivityIds.size > 0
    ? activityRuns.filter((row) => reachableActivityIds.has(row.activity_id))
    : activityRuns;

  const state = summarizeActivityState(relevantRuns);

  const shouldFail = state.requiredFailureCount > 0;
  const shouldComplete = !shouldFail && state.inProgressCount === 0;

  if (!shouldFail && !shouldComplete) {
    return {
      workflow_run_id: workflowRunId,
      previous_status: previousStatus,
      final_status: previousStatus,
      action: "still_running",
      in_progress_count: state.inProgressCount,
      required_failure_count: state.requiredFailureCount,
      completed_activity_count: state.completedCount,
      failed_activity_count: state.failedCount,
      cancelled_activity_count: state.cancelledCount,
      optional_failure_count: state.optionalFailureCount,
      message: "Workflow still has in-progress activities",
    };
  }

  const finalStatus: "completed" | "failed" = shouldFail ? "failed" : "completed";
  const finalOutput = buildWorkflowFinalOutput(workflowRunId, finalStatus, relevantRuns);
  const nowIso = new Date().toISOString();

  const updatePayload: Record<string, unknown> = {
    status: finalStatus,
    completed_at: nowIso,
    output_payload: finalOutput,
    updated_at: nowIso,
  };

  if (finalStatus === "failed") {
    updatePayload.failure_reason = inferFailedReason(state.requiredFailureCount, trigger);
  }

  const { data: updatedRows, error: updateError } = await supabase
    .from("workflow_runs")
    .update(updatePayload)
    .eq("id", workflowRunId)
    .in("status", ["pending", "running"])
    .select("id");

  if (updateError) {
    throw new Error(`Failed to finalize workflow ${workflowRunId}: ${updateError.message}`);
  }

  const changed = Array.isArray(updatedRows) && updatedRows.length > 0;

  if (!changed) {
    const currentStatus = await loadWorkflowStatus(supabase, workflowRunId);
    return {
      workflow_run_id: workflowRunId,
      previous_status: previousStatus,
      final_status: currentStatus,
      action: "concurrent_terminal",
      in_progress_count: state.inProgressCount,
      required_failure_count: state.requiredFailureCount,
      completed_activity_count: state.completedCount,
      failed_activity_count: state.failedCount,
      cancelled_activity_count: state.cancelledCount,
      optional_failure_count: state.optionalFailureCount,
      message: "Workflow terminal transition already applied by another caller",
    };
  }

  const eventType = finalStatus === "completed" ? "workflow_completed" : "workflow_failed";

  const eventDetails: Record<string, unknown> = {
    reason:
      finalStatus === "failed"
        ? inferFailedReason(state.requiredFailureCount, trigger)
        : "all_required_work_terminal_success",
    required_failure_count: state.requiredFailureCount,
    completed_activity_count: state.completedCount,
    failed_activity_count: state.failedCount,
    cancelled_activity_count: state.cancelledCount,
    optional_failure_count: state.optionalFailureCount,
    in_progress_count: state.inProgressCount,
    source: "phase8_finalization",
    finalized_at: nowIso,
    output_builder_version: "phase8_mvp_v1",
  };

  if (trigger.activity_run_id) {
    eventDetails.activity_run_id = trigger.activity_run_id;
  }

  if (trigger.details && typeof trigger.details === "object") {
    eventDetails.trigger_details = trigger.details;
  }

  const { error: eventError } = await supabase.from("workflow_events").insert({
    workflow_run_id: workflowRunId,
    activity_run_id: trigger.activity_run_id ?? null,
    event_type: eventType,
    actor,
    details: eventDetails,
  });

  if (eventError) {
    console.warn(
      `Failed to write ${eventType} event for workflow ${workflowRunId}: ${eventError.message}`
    );
  }

  return {
    workflow_run_id: workflowRunId,
    previous_status: previousStatus,
    final_status: finalStatus,
    action: finalStatus === "completed" ? "finalized_completed" : "finalized_failed",
    in_progress_count: state.inProgressCount,
    required_failure_count: state.requiredFailureCount,
    completed_activity_count: state.completedCount,
    failed_activity_count: state.failedCount,
    cancelled_activity_count: state.cancelledCount,
    optional_failure_count: state.optionalFailureCount,
    message:
      finalStatus === "completed"
        ? "Workflow finalized as completed"
        : "Workflow finalized as failed",
  };
}
