// @ts-nocheck
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { dispatchHandler, initializeBuiltInHandlers } from "./registry.ts";
import {
  loadActivityExecutionContext,
  createActivityAttempt,
  updateActivityAttemptOnStart,
  updateActivityAttemptOnFinish,
} from "./activity-helpers.ts";
import {
  completeActivityRun,
  failActivityRun,
  failWorkflowForRequiredActivity,
  finalizeWorkflowIfComplete,
  applyWorkflowContextPatch,
} from "./orchestration-helpers.ts";
import { normalizeFailureError } from "./retry-policy.ts";
import type {
  HandlerExecutionInput,
  ActivityExecutionContext,
  WorkerResponse,
} from "./contracts.ts";

const WORKER_ID = `worker-${new Date().getTime()}-${Math.random().toString(36).slice(2, 9)}`;

export async function runWorkerLoop(
  supabase: SupabaseClient,
  maxActivitiesToProcess: number = 1,
  leaseSeconds: number = 300,
  handlerKeys?: string[],
  debug: boolean = false
): Promise<WorkerResponse> {
  // Initialize handler registry on first invocation
  initializeBuiltInHandlers();

  const response: WorkerResponse = {
    processed_count: 0,
    claimed_count: 0,
    completed_count: 0,
    failed_count: 0,
    retried_count: 0,
    workflow_run_ids_touched: [],
    activity_run_ids_processed: [],
    message: "Worker loop completed",
  };

  const maxToProcess = Math.min(Math.max(maxActivitiesToProcess, 1), 5);
  const touchedWorkflows = new Set<string>();

  for (let i = 0; i < maxToProcess; i++) {
    // Claim next activity
    const { data: claimedActivityId, error: claimError } = await supabase.rpc(
      "claim_next_activity",
      {
        p_worker_id: WORKER_ID,
        p_lease_seconds: leaseSeconds,
        p_handler_keys: handlerKeys,
      }
    );

    if (claimError) {
      console.error(`Claim error: ${claimError.message}`);
      break;
    }

    if (!claimedActivityId) {
      if (debug) console.log("No activity claimed, exiting worker loop");
      break;
    }

    response.claimed_count += 1;
    response.activity_run_ids_processed.push(claimedActivityId);

    try {
      // Load execution context
      const context: ActivityExecutionContext =
        await loadActivityExecutionContext(supabase, claimedActivityId);

      touchedWorkflows.add(context.workflow_run.id);

      const nowIso = new Date().toISOString();
      const nextAttemptNumber = context.activity_run.attempt_count;

      // Create activity_attempts record
      const attemptId = await createActivityAttempt(
        supabase,
        claimedActivityId,
        context.workflow_run.id,
        nextAttemptNumber,
        WORKER_ID,
        context.activity_run.input_payload
      );

      // Mark as running
      await updateActivityAttemptOnStart(supabase, attemptId, nowIso);
      const { error: runningError } = await supabase
        .from("activity_runs")
        .update({
          status: "running",
          started_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", claimedActivityId);

      if (runningError) {
        throw new Error(`Failed to set running status: ${runningError.message}`);
      }

      // Write activity_started event
      await supabase.from("workflow_events").insert({
        workflow_run_id: context.workflow_run.id,
        activity_run_id: claimedActivityId,
        event_type: "activity_started",
        actor: "worker",
        details: {
          worker_id: WORKER_ID,
          started_at: nowIso,
          attempt_number: nextAttemptNumber,
        },
      });

      // Execute handler
      const handlerInput: HandlerExecutionInput = {
        workflow_run_id: context.workflow_run.id,
        activity_run_id: claimedActivityId,
        workflow_definition_id: context.workflow_run.workflow_definition_id,
        workflow_context:
          typeof context.workflow_run.context === "object" &&
          context.workflow_run.context !== null &&
          !Array.isArray(context.workflow_run.context)
            ? context.workflow_run.context
            : {},
        activity_input_payload: context.activity_run.input_payload,
        activity_key: context.activity_run.activity_key,
        handler_key: context.activity_run.handler_key,
        attempt_count: nextAttemptNumber,
        max_attempts: context.activity_run.max_attempts,
      };

      const result = await dispatchHandler(
        context.activity_run.handler_key,
        handlerInput
      );

      const finishedAtIso = new Date().toISOString();

      if (result.ok) {
        // Success path
        await updateActivityAttemptOnFinish(
          supabase,
          attemptId,
          finishedAtIso,
          result.output_payload,
          undefined,
          undefined,
          nowIso
        );

        await completeActivityRun(
          supabase,
          claimedActivityId,
          context.workflow_run.id,
          result.output_payload
        );

        // Merge lightweight context patch (if provided) after handler acceptance.
        if (result.context_patch) {
          try {
            const patchSummary = await applyWorkflowContextPatch(
              supabase,
              context.workflow_run.id,
              claimedActivityId,
              result.context_patch,
              "worker"
            );
            if (debug) {
              console.log(
                `Context patch merge (success path): applied=${patchSummary.applied}, reason=${patchSummary.reason ?? "n/a"}, keys=${patchSummary.patch_keys.join(",")}`
              );
            }
          } catch (patchError) {
            console.warn(
              `Context patch merge failed on success path for activity ${claimedActivityId}: ${patchError instanceof Error ? patchError.message : String(patchError)}`
            );
          }
        }

        // Schedule downstream activities
        const { data: scheduledIds, error: scheduleError } = await supabase.rpc(
          "schedule_downstream_activities",
          {
            p_workflow_run_id: context.workflow_run.id,
            p_completed_activity_id: context.activity_run.activity_id,
            p_actor: "worker",
          }
        );

        if (scheduleError) {
          console.warn(
            `Failed to schedule downstream: ${scheduleError.message}`
          );
        } else if (debug && scheduledIds) {
          console.log(`Scheduled ${scheduledIds.length} downstream activities`);
        }

        response.completed_count += 1;

        // Finalize workflow if complete
        const isComplete = await finalizeWorkflowIfComplete(
          supabase,
          context.workflow_run.id
        );
        if (debug) console.log(`Workflow finalization check: ${isComplete}`);
      } else {
        // Failure path
        const normalizedFailure = normalizeFailureError(result.error);
        const isRetryable = normalizedFailure.classification === "retryable";

        const failureDetails = {
          code: normalizedFailure.code,
          category: normalizedFailure.category,
          classification: normalizedFailure.classification,
          details: normalizedFailure.details ?? null,
        };

        const willRetry = await failActivityRun(
          supabase,
          claimedActivityId,
          context.workflow_run.id,
          nextAttemptNumber,
          context.activity_run.max_attempts,
          context.activity_run.retry_backoff_seconds,
          context.activity_run.retry_backoff_multiplier,
          normalizedFailure.message,
          isRetryable,
          failureDetails
        );

        await updateActivityAttemptOnFinish(
          supabase,
          attemptId,
          finishedAtIso,
          null,
          normalizedFailure.message,
          failureDetails,
          nowIso
        );

        // Merge lightweight failure-side context patch if handler supplies one.
        if (result.context_patch) {
          try {
            const patchSummary = await applyWorkflowContextPatch(
              supabase,
              context.workflow_run.id,
              claimedActivityId,
              result.context_patch,
              "worker"
            );
            if (debug) {
              console.log(
                `Context patch merge (failure path): applied=${patchSummary.applied}, reason=${patchSummary.reason ?? "n/a"}, keys=${patchSummary.patch_keys.join(",")}`
              );
            }
          } catch (patchError) {
            console.warn(
              `Context patch merge failed on failure path for activity ${claimedActivityId}: ${patchError instanceof Error ? patchError.message : String(patchError)}`
            );
          }
        }

        if (willRetry) {
          response.retried_count += 1;
        } else {
          response.failed_count += 1;

          if (!context.activity_run.is_optional) {
            const failedWorkflow = await failWorkflowForRequiredActivity(
              supabase,
              context.workflow_run.id,
              claimedActivityId,
              "required_activity_terminal_failure",
              {
                activity_key: context.activity_run.activity_key,
                handler_key: context.activity_run.handler_key,
                ...failureDetails,
              }
            );

            if (debug) {
              console.log(
                `Required terminal failure triggered workflow failure: ${failedWorkflow}`
              );
            }
          } else {
            // Optional activity terminal failure does not immediately fail workflow.
            const isComplete = await finalizeWorkflowIfComplete(
              supabase,
              context.workflow_run.id
            );
            if (debug) {
              console.log(`Workflow finalization after optional failure: ${isComplete}`);
            }
          }
        }
      }

      response.processed_count += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error during processing";
      console.error(`Error processing activity ${claimedActivityId}: ${message}`);
      response.failed_count += 1;

      try {
        // Attempt to mark activity as failed
        const { data: activityRun } = await supabase
          .from("activity_runs")
          .select("workflow_run_id")
          .eq("id", claimedActivityId)
          .single();

        if (activityRun) {
          await supabase
            .from("activity_runs")
            .update({
              status: "failed",
              error_message: message,
              claimed_by: null,
              lease_expires_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", claimedActivityId);

          await finalizeWorkflowIfComplete(
            supabase,
            activityRun.workflow_run_id
          );
        }
      } catch (cleanupError) {
        console.error(`Failed to clean up after error: ${cleanupError}`);
      }
    }
  }

  response.workflow_run_ids_touched = Array.from(touchedWorkflows);

  return response;
}
