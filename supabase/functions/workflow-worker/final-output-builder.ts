import type { JsonValue } from "./contracts.ts";

interface ActivityRunForFinalOutput {
  id: string;
  activity_key: string;
  status: string;
  is_optional: boolean;
  output_payload: JsonValue;
  error_message: string | null;
}

function sortByActivityKey(
  left: ActivityRunForFinalOutput,
  right: ActivityRunForFinalOutput
): number {
  return left.activity_key.localeCompare(right.activity_key);
}

function buildCompletedOutputsByKey(
  activityRuns: ActivityRunForFinalOutput[]
): Record<string, JsonValue> {
  const completed = activityRuns
    .filter((row) => row.status === "completed")
    .sort(sortByActivityKey);

  const outputs: Record<string, JsonValue> = {};
  for (const row of completed) {
    outputs[row.activity_key] = row.output_payload ?? null;
  }

  return outputs;
}

export function buildWorkflowFinalOutput(
  workflowRunId: string,
  finalStatus: "completed" | "failed",
  activityRuns: ActivityRunForFinalOutput[]
): JsonValue {
  const completedCount = activityRuns.filter((row) => row.status === "completed").length;
  const failedCount = activityRuns.filter((row) => row.status === "failed").length;
  const cancelledCount = activityRuns.filter((row) => row.status === "cancelled").length;

  const requiredFailureCount = activityRuns.filter(
    (row) => !row.is_optional && (row.status === "failed" || row.status === "cancelled")
  ).length;

  const optionalFailureCount = activityRuns.filter(
    (row) => row.is_optional && (row.status === "failed" || row.status === "cancelled")
  ).length;

  const inProgressCount = activityRuns.filter((row) =>
    ["pending", "queued", "claimed", "running", "waiting_retry"].includes(row.status)
  ).length;

  const failedActivityMessages = activityRuns
    .filter((row) => row.status === "failed" || row.status === "cancelled")
    .sort(sortByActivityKey)
    .map((row) => ({
      activity_key: row.activity_key,
      status: row.status,
      is_optional: row.is_optional,
      error_message: row.error_message,
    }));

  return {
    workflow_run_id: workflowRunId,
    final_status: finalStatus,
    completed_activity_count: completedCount,
    failed_activity_count: failedCount,
    cancelled_activity_count: cancelledCount,
    required_failure_count: requiredFailureCount,
    optional_failure_count: optionalFailureCount,
    in_progress_activity_count: inProgressCount,
    completed_outputs_by_activity_key: buildCompletedOutputsByKey(activityRuns),
    failed_activity_summaries: failedActivityMessages,
    finalized_at: new Date().toISOString(),
    output_builder_version: "phase8_mvp_v1",
  };
}
