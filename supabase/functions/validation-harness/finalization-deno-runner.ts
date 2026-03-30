// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { startWorkflowRunMaterialization } from "../workflow-start/materialization-service.ts";
import { runWorkerLoop } from "../workflow-worker/worker-loop.ts";
import { finalizeWorkflowRunState } from "../workflow-worker/workflow-finalization.ts";
import { recoverStaleActivityRuns } from "../workflow-worker/stale-recovery-service.ts";

interface AssertionResult {
  name: string;
  passed: boolean;
  message: string;
  error?: string;
}

interface ScenarioResult {
  scenario: string;
  assertions: AssertionResult[];
  all_passed: boolean;
  summary: string;
}

interface ValidationActivitySeed {
  key: string;
  name: string;
  handler_key: string;
  is_entry: boolean;
  is_terminal: boolean;
  is_optional: boolean;
  retry_max_attempts: number;
  retry_backoff_seconds: number;
  retry_backoff_multiplier: number;
  execution_priority: number;
}

interface ValidationEdgeSeed {
  from_key: string;
  to_key: string;
}

function assert(
  name: string,
  condition: boolean,
  message: string,
  error?: string
): AssertionResult {
  return {
    name,
    passed: condition,
    message,
    error: condition ? undefined : error,
  };
}

function assertEqual(
  name: string,
  actual: unknown,
  expected: unknown,
  message: string
): AssertionResult {
  const passed = actual === expected;
  return {
    name,
    passed,
    message,
    error: passed ? undefined : `Expected ${expected}, got ${actual}`,
  };
}

function summarize(assertions: AssertionResult[]): string {
  const passed = assertions.filter((a) => a.passed).length;
  return `${passed}/${assertions.length} passed`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilRetryDue(nextRetryAtIso: string): Promise<void> {
  const dueMs = new Date(nextRetryAtIso).getTime();
  const nowMs = Date.now();
  const waitMs = Math.max(dueMs - nowMs + 150, 150);
  await sleep(waitMs);
}

async function ensureValidationWorkflow(
  supabase: ReturnType<typeof createClient>,
  key: string,
  name: string,
  activities: ValidationActivitySeed[],
  edges: ValidationEdgeSeed[]
): Promise<{ definitionId: string; versionId: string }> {
  const nowIso = new Date().toISOString();

  const { error: upsertDefinitionError } = await supabase
    .from("workflow_definitions")
    .upsert(
      {
        key,
        name,
        status: "active",
        updated_at: nowIso,
      },
      { onConflict: "key" }
    );

  if (upsertDefinitionError) {
    throw new Error(
      `Failed to upsert workflow definition ${key}: ${upsertDefinitionError.message}`
    );
  }

  const { data: definition, error: definitionError } = await supabase
    .from("workflow_definitions")
    .select("id")
    .eq("key", key)
    .single();

  if (definitionError || !definition) {
    throw new Error(
      `Failed to resolve workflow definition ${key}: ${definitionError?.message ?? "not found"}`
    );
  }

  const { error: upsertVersionError } = await supabase
    .from("workflow_definition_versions")
    .upsert(
      {
        workflow_definition_id: definition.id,
        version: 1,
        is_current: true,
        default_context: {},
      },
      { onConflict: "workflow_definition_id,version" }
    );

  if (upsertVersionError) {
    throw new Error(
      `Failed to upsert workflow version for ${key}: ${upsertVersionError.message}`
    );
  }

  const { data: version, error: versionError } = await supabase
    .from("workflow_definition_versions")
    .select("id")
    .eq("workflow_definition_id", definition.id)
    .eq("version", 1)
    .single();

  if (versionError || !version) {
    throw new Error(
      `Failed to resolve workflow version for ${key}: ${versionError?.message ?? "not found"}`
    );
  }

  const activityRows = activities.map((activity) => ({
    version_id: version.id,
    key: activity.key,
    name: activity.name,
    handler_key: activity.handler_key,
    is_entry: activity.is_entry,
    is_terminal: activity.is_terminal,
    is_optional: activity.is_optional,
    retry_max_attempts: activity.retry_max_attempts,
    retry_backoff_seconds: activity.retry_backoff_seconds,
    retry_backoff_multiplier: activity.retry_backoff_multiplier,
    execution_priority: activity.execution_priority,
    created_at: nowIso,
  }));

  const { error: upsertActivitiesError } = await supabase
    .from("workflow_activities")
    .upsert(activityRows, { onConflict: "version_id,key" });

  if (upsertActivitiesError) {
    throw new Error(
      `Failed to upsert activities for ${key}: ${upsertActivitiesError.message}`
    );
  }

  const { data: activityRecords, error: activityRecordsError } = await supabase
    .from("workflow_activities")
    .select("id, key")
    .eq("version_id", version.id);

  if (activityRecordsError || !activityRecords) {
    throw new Error(
      `Failed to load activities for ${key}: ${activityRecordsError?.message ?? "not found"}`
    );
  }

  const activityIdByKey = new Map(activityRecords.map((a) => [a.key, a.id]));

  if (edges.length > 0) {
    const edgeRows = edges.map((edge) => {
      const fromId = activityIdByKey.get(edge.from_key);
      const toId = activityIdByKey.get(edge.to_key);
      if (!fromId || !toId) {
        throw new Error(`Invalid edge for ${key}: ${edge.from_key} -> ${edge.to_key}`);
      }
      return {
        version_id: version.id,
        from_activity_id: fromId,
        to_activity_id: toId,
        join_policy: "all",
        created_at: nowIso,
      };
    });

    const { error: edgeError } = await supabase
      .from("workflow_edges")
      .upsert(edgeRows, { onConflict: "from_activity_id,to_activity_id" });

    if (edgeError) {
      throw new Error(`Failed to upsert edges for ${key}: ${edgeError.message}`);
    }
  }

  return {
    definitionId: definition.id,
    versionId: version.id,
  };
}

async function fetchWorkflowRun(
  supabase: ReturnType<typeof createClient>,
  workflowRunId: string
) {
  const { data, error } = await supabase
    .from("workflow_runs")
    .select("id, status, output_payload, completed_at")
    .eq("id", workflowRunId)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to load workflow run ${workflowRunId}: ${error?.message ?? "not found"}`
    );
  }

  return data;
}

async function fetchActivityRunByKey(
  supabase: ReturnType<typeof createClient>,
  workflowRunId: string,
  activityKey: string
) {
  const { data, error } = await supabase
    .from("activity_runs")
    .select("id, status, attempt_count, next_retry_at, lease_expires_at")
    .eq("workflow_run_id", workflowRunId)
    .eq("activity_key", activityKey)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to load activity ${activityKey}: ${error?.message ?? "not found"}`
    );
  }

  return data;
}

async function countWorkflowEvents(
  supabase: ReturnType<typeof createClient>,
  workflowRunId: string,
  eventType: "workflow_completed" | "workflow_failed"
): Promise<number> {
  const { count, error } = await supabase
    .from("workflow_events")
    .select("id", { count: "exact", head: true })
    .eq("workflow_run_id", workflowRunId)
    .eq("event_type", eventType);

  if (error) {
    throw new Error(`Failed to count workflow events: ${error.message}`);
  }

  return count ?? 0;
}

async function simulateClaimForActivity(
  supabase: ReturnType<typeof createClient>,
  activityRunId: string,
  workerId: string,
  leaseSeconds: number = 60
): Promise<void> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const leaseIso = new Date(now + leaseSeconds * 1000).toISOString();

  const { data, error } = await supabase
    .from("activity_runs")
    .update({
      status: "claimed",
      claimed_by: workerId,
      claimed_at: nowIso,
      lease_expires_at: leaseIso,
      attempt_count: 1,
      updated_at: nowIso,
    })
    .eq("id", activityRunId)
    .eq("status", "queued")
    .select("id");

  if (error) {
    throw new Error(`Failed to simulate claim for ${activityRunId}: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error(`Simulated claim did not update ${activityRunId}`);
  }
}

async function ensureAttemptExists(
  supabase: ReturnType<typeof createClient>,
  activityRunId: string,
  workflowRunId: string,
  attemptNumber: number,
  workerId: string
): Promise<void> {
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from("activity_attempts")
    .upsert(
      {
        activity_run_id: activityRunId,
        workflow_run_id: workflowRunId,
        attempt_number: attemptNumber,
        claimed_by: workerId,
        claimed_at: nowIso,
        started_at: nowIso,
      },
      { onConflict: "activity_run_id,attempt_number" }
    );

  if (error) {
    throw new Error(`Failed to ensure activity attempt: ${error.message}`);
  }
}

async function markActivityRunningStale(
  supabase: ReturnType<typeof createClient>,
  activityRunId: string,
  workerId: string
): Promise<void> {
  const now = Date.now();
  const claimedIso = new Date(now - 30000).toISOString();
  const startedIso = new Date(now - 25000).toISOString();
  const leaseIso = new Date(now - 5000).toISOString();

  const { error } = await supabase
    .from("activity_runs")
    .update({
      status: "running",
      claimed_by: workerId,
      claimed_at: claimedIso,
      started_at: startedIso,
      lease_expires_at: leaseIso,
      updated_at: new Date().toISOString(),
    })
    .eq("id", activityRunId);

  if (error) {
    throw new Error(`Failed to mark stale running ${activityRunId}: ${error.message}`);
  }
}

async function validateSimpleCompletionAndIdempotency(
  supabase: ReturnType<typeof createClient>
): Promise<ScenarioResult> {
  const scenario = "F1: simple completion finalizes once with stable output";
  const assertions: AssertionResult[] = [];

  try {
    const workflowKey = "validation.finalization.simple_success";

    await ensureValidationWorkflow(
      supabase,
      workflowKey,
      "Validation: Finalization Simple Success",
      [
        {
          key: "A",
          name: "Simple Success",
          handler_key: "debug.noop",
          is_entry: true,
          is_terminal: true,
          is_optional: false,
          retry_max_attempts: 3,
          retry_backoff_seconds: 1,
          retry_backoff_multiplier: 1,
          execution_priority: 10,
        },
      ],
      []
    );

    const run = await startWorkflowRunMaterialization(
      supabase,
      { definition_key: workflowKey },
      null
    );

    await runWorkerLoop(supabase, 1, 300, ["debug.noop"], false);

    const workflow = await fetchWorkflowRun(supabase, run.workflow_run_id);
    const output = workflow.output_payload as Record<string, unknown> | null;

    assertions.push(
      assertEqual(
        "F1-1 workflow completed",
        workflow.status,
        "completed",
        "Simple success workflow should finalize as completed"
      )
    );

    assertions.push(
      assert(
        "F1-2 final output payload is set",
        output !== null && typeof output === "object",
        "output_payload should be written at finalization",
        JSON.stringify(workflow.output_payload)
      )
    );

    assertions.push(
      assertEqual(
        "F1-3 output final_status",
        output?.final_status,
        "completed",
        "output_payload.final_status should match workflow status"
      )
    );

    assertions.push(
      assertEqual(
        "F1-4 output completed_activity_count",
        output?.completed_activity_count,
        1,
        "completed_activity_count should be deterministic"
      )
    );

    assertions.push(
      assertEqual(
        "F1-5 workflow_completed event emitted once",
        await countWorkflowEvents(supabase, run.workflow_run_id, "workflow_completed"),
        1,
        "Repeated finalization should not duplicate workflow_completed event"
      )
    );

    const outputBefore = JSON.stringify(workflow.output_payload ?? null);

    const summary1 = await finalizeWorkflowRunState(supabase, run.workflow_run_id, {
      actor: "phase8-validation",
      reason: "idempotency_check",
    });

    const summary2 = await finalizeWorkflowRunState(supabase, run.workflow_run_id, {
      actor: "phase8-validation",
      reason: "idempotency_check",
    });

    assertions.push(
      assert(
        "F1-6 repeated finalization reports already terminal",
        ["already_terminal", "concurrent_terminal"].includes(summary1.action) &&
          ["already_terminal", "concurrent_terminal"].includes(summary2.action),
        "Finalization should no-op for terminal workflow",
        `${summary1.action}, ${summary2.action}`
      )
    );

    const workflowAfter = await fetchWorkflowRun(supabase, run.workflow_run_id);
    const outputAfter = JSON.stringify(workflowAfter.output_payload ?? null);

    assertions.push(
      assertEqual(
        "F1-7 output payload remains stable",
        outputAfter,
        outputBefore,
        "Final output should not be rewritten after terminal state"
      )
    );

    assertions.push(
      assertEqual(
        "F1-8 workflow_completed event still once",
        await countWorkflowEvents(supabase, run.workflow_run_id, "workflow_completed"),
        1,
        "No duplicate workflow_completed events should be written"
      )
    );
  } catch (error) {
    assertions.push(assert("F1 fatal", false, scenario, String(error)));
  }

  return {
    scenario,
    assertions,
    all_passed: assertions.every((a) => a.passed),
    summary: summarize(assertions),
  };
}

async function validateFanInCompletionGating(
  supabase: ReturnType<typeof createClient>
): Promise<ScenarioResult> {
  const scenario = "F2: fan-in workflow completes only after all required work";
  const assertions: AssertionResult[] = [];

  try {
    const workflowKey = "validation.finalization.fanin.gating";

    await ensureValidationWorkflow(
      supabase,
      workflowKey,
      "Validation: Finalization Fan-in Gating",
      [
        {
          key: "A",
          name: "Start",
          handler_key: "debug.noop",
          is_entry: true,
          is_terminal: false,
          is_optional: false,
          retry_max_attempts: 3,
          retry_backoff_seconds: 1,
          retry_backoff_multiplier: 1,
          execution_priority: 10,
        },
        {
          key: "B",
          name: "Branch B",
          handler_key: "debug.noop",
          is_entry: false,
          is_terminal: false,
          is_optional: false,
          retry_max_attempts: 3,
          retry_backoff_seconds: 1,
          retry_backoff_multiplier: 1,
          execution_priority: 9,
        },
        {
          key: "C",
          name: "Branch C",
          handler_key: "debug.noop",
          is_entry: false,
          is_terminal: false,
          is_optional: false,
          retry_max_attempts: 3,
          retry_backoff_seconds: 1,
          retry_backoff_multiplier: 1,
          execution_priority: 8,
        },
        {
          key: "D",
          name: "Join",
          handler_key: "debug.noop",
          is_entry: false,
          is_terminal: true,
          is_optional: false,
          retry_max_attempts: 3,
          retry_backoff_seconds: 1,
          retry_backoff_multiplier: 1,
          execution_priority: 7,
        },
      ],
      [
        { from_key: "A", to_key: "B" },
        { from_key: "A", to_key: "C" },
        { from_key: "B", to_key: "D" },
        { from_key: "C", to_key: "D" },
      ]
    );

    const run = await startWorkflowRunMaterialization(
      supabase,
      { definition_key: workflowKey },
      null
    );

    await runWorkerLoop(supabase, 1, 300, ["debug.noop"], false);

    const firstSummary = await finalizeWorkflowRunState(supabase, run.workflow_run_id, {
      actor: "phase8-validation",
      reason: "fanin_gate_check_1",
    });

    assertions.push(
      assertEqual(
        "F2-1 still running after first activity",
        firstSummary.action,
        "still_running",
        "Workflow should remain running while required work is pending"
      )
    );

    await runWorkerLoop(supabase, 1, 300, ["debug.noop"], false);

    const secondSummary = await finalizeWorkflowRunState(supabase, run.workflow_run_id, {
      actor: "phase8-validation",
      reason: "fanin_gate_check_2",
    });

    assertions.push(
      assert(
        "F2-2 still running before join activity completes",
        secondSummary.action === "still_running" || secondSummary.final_status === "running",
        "Workflow should not complete until all required branch work is terminally successful",
        JSON.stringify(secondSummary)
      )
    );

    await runWorkerLoop(supabase, 5, 300, ["debug.noop"], false);

    const workflow = await fetchWorkflowRun(supabase, run.workflow_run_id);

    assertions.push(
      assertEqual(
        "F2-3 workflow eventually completes",
        workflow.status,
        "completed",
        "Fan-in workflow should complete after all required work finishes"
      )
    );

    assertions.push(
      assertEqual(
        "F2-4 workflow_completed event once",
        await countWorkflowEvents(supabase, run.workflow_run_id, "workflow_completed"),
        1,
        "workflow_completed should be emitted once"
      )
    );
  } catch (error) {
    assertions.push(assert("F2 fatal", false, scenario, String(error)));
  }

  return {
    scenario,
    assertions,
    all_passed: assertions.every((a) => a.passed),
    summary: summarize(assertions),
  };
}

async function validateRequiredFailureFinalization(
  supabase: ReturnType<typeof createClient>
): Promise<ScenarioResult> {
  const scenario = "F3: required terminal failure finalizes workflow as failed";
  const assertions: AssertionResult[] = [];

  try {
    const workflowKey = "validation.finalization.required.failure";

    await ensureValidationWorkflow(
      supabase,
      workflowKey,
      "Validation: Finalization Required Failure",
      [
        {
          key: "A",
          name: "Required Fail",
          handler_key: "debug.fail_terminal",
          is_entry: true,
          is_terminal: true,
          is_optional: false,
          retry_max_attempts: 3,
          retry_backoff_seconds: 1,
          retry_backoff_multiplier: 1,
          execution_priority: 10,
        },
      ],
      []
    );

    const run = await startWorkflowRunMaterialization(
      supabase,
      { definition_key: workflowKey },
      null
    );

    await runWorkerLoop(supabase, 1, 300, ["debug.fail_terminal"], false);

    const workflow = await fetchWorkflowRun(supabase, run.workflow_run_id);
    const output = workflow.output_payload as Record<string, unknown> | null;

    assertions.push(
      assertEqual(
        "F3-1 workflow failed",
        workflow.status,
        "failed",
        "Required terminal failure should fail workflow"
      )
    );

    assertions.push(
      assertEqual(
        "F3-2 workflow_failed event once",
        await countWorkflowEvents(supabase, run.workflow_run_id, "workflow_failed"),
        1,
        "workflow_failed should be emitted once"
      )
    );

    assertions.push(
      assertEqual(
        "F3-3 output final_status failed",
        output?.final_status,
        "failed",
        "Final output should reflect failed status"
      )
    );

    assertions.push(
      assert(
        "F3-4 required_failure_count captured",
        Number(output?.required_failure_count ?? 0) >= 1,
        "Final output should include required failure count",
        JSON.stringify(output)
      )
    );

    const outputBefore = JSON.stringify(workflow.output_payload ?? null);

    await finalizeWorkflowRunState(supabase, run.workflow_run_id, {
      actor: "phase8-validation",
      reason: "repeat_finalization",
    });

    await finalizeWorkflowRunState(supabase, run.workflow_run_id, {
      actor: "phase8-validation",
      reason: "repeat_finalization",
    });

    const workflowAfter = await fetchWorkflowRun(supabase, run.workflow_run_id);

    assertions.push(
      assertEqual(
        "F3-5 failed output remains stable",
        JSON.stringify(workflowAfter.output_payload ?? null),
        outputBefore,
        "Final output should not be rewritten for terminal workflow"
      )
    );

    assertions.push(
      assertEqual(
        "F3-6 workflow_failed event still once",
        await countWorkflowEvents(supabase, run.workflow_run_id, "workflow_failed"),
        1,
        "No duplicate workflow_failed events should be emitted"
      )
    );
  } catch (error) {
    assertions.push(assert("F3 fatal", false, scenario, String(error)));
  }

  return {
    scenario,
    assertions,
    all_passed: assertions.every((a) => a.passed),
    summary: summarize(assertions),
  };
}

async function validateOptionalFailureNonBlocking(
  supabase: ReturnType<typeof createClient>
): Promise<ScenarioResult> {
  const scenario = "F4: optional terminal failure does not block completion";
  const assertions: AssertionResult[] = [];

  try {
    const workflowKey = "validation.finalization.optional.nonblocking";

    await ensureValidationWorkflow(
      supabase,
      workflowKey,
      "Validation: Finalization Optional Non-blocking",
      [
        {
          key: "REQ",
          name: "Required Success",
          handler_key: "debug.noop",
          is_entry: true,
          is_terminal: true,
          is_optional: false,
          retry_max_attempts: 3,
          retry_backoff_seconds: 1,
          retry_backoff_multiplier: 1,
          execution_priority: 10,
        },
        {
          key: "OPT",
          name: "Optional Failure",
          handler_key: "debug.fail_terminal",
          is_entry: true,
          is_terminal: true,
          is_optional: true,
          retry_max_attempts: 3,
          retry_backoff_seconds: 1,
          retry_backoff_multiplier: 1,
          execution_priority: 1,
        },
      ],
      []
    );

    const run = await startWorkflowRunMaterialization(
      supabase,
      { definition_key: workflowKey },
      null
    );

    await runWorkerLoop(
      supabase,
      2,
      300,
      ["debug.noop", "debug.fail_terminal"],
      false
    );

    const workflow = await fetchWorkflowRun(supabase, run.workflow_run_id);
    const req = await fetchActivityRunByKey(supabase, run.workflow_run_id, "REQ");
    const opt = await fetchActivityRunByKey(supabase, run.workflow_run_id, "OPT");
    const output = workflow.output_payload as Record<string, unknown> | null;

    assertions.push(
      assertEqual(
        "F4-1 required activity completed",
        req.status,
        "completed",
        "Required activity should complete"
      )
    );

    assertions.push(
      assertEqual(
        "F4-2 optional activity failed",
        opt.status,
        "failed",
        "Optional activity may fail terminally"
      )
    );

    assertions.push(
      assertEqual(
        "F4-3 workflow completed",
        workflow.status,
        "completed",
        "Optional terminal failure should not block completion"
      )
    );

    assertions.push(
      assertEqual(
        "F4-4 workflow_failed event not emitted",
        await countWorkflowEvents(supabase, run.workflow_run_id, "workflow_failed"),
        0,
        "No workflow_failed event expected for optional-only failure"
      )
    );

    assertions.push(
      assert(
        "F4-5 output includes optional failure count",
        Number(output?.optional_failure_count ?? 0) >= 1,
        "Final output should include optional failure information",
        JSON.stringify(output)
      )
    );
  } catch (error) {
    assertions.push(assert("F4 fatal", false, scenario, String(error)));
  }

  return {
    scenario,
    assertions,
    all_passed: assertions.every((a) => a.passed),
    summary: summarize(assertions),
  };
}

async function validateRetryAndStaleRecoveryGating(
  supabase: ReturnType<typeof createClient>
): Promise<ScenarioResult> {
  const scenario = "F5: waiting_retry and stale recovery do not finalize prematurely";
  const assertions: AssertionResult[] = [];

  try {
    const retryWorkflowKey = "validation.finalization.waiting_retry_gate";

    await ensureValidationWorkflow(
      supabase,
      retryWorkflowKey,
      "Validation: Finalization Waiting Retry",
      [
        {
          key: "A",
          name: "Retry Gate",
          handler_key: "debug.fail_n_times_then_succeed",
          is_entry: true,
          is_terminal: true,
          is_optional: false,
          retry_max_attempts: 3,
          retry_backoff_seconds: 1,
          retry_backoff_multiplier: 1,
          execution_priority: 10,
        },
      ],
      []
    );

    const retryRun = await startWorkflowRunMaterialization(
      supabase,
      {
        definition_key: retryWorkflowKey,
        input_payload: {
          fail_times: 1,
        },
      },
      null
    );

    await runWorkerLoop(
      supabase,
      1,
      300,
      ["debug.fail_n_times_then_succeed"],
      false
    );

    const retryActivity = await fetchActivityRunByKey(supabase, retryRun.workflow_run_id, "A");

    assertions.push(
      assertEqual(
        "F5-1 activity enters waiting_retry",
        retryActivity.status,
        "waiting_retry",
        "Retryable failure should enter waiting_retry"
      )
    );

    const retrySummary = await finalizeWorkflowRunState(
      supabase,
      retryRun.workflow_run_id,
      {
        actor: "phase8-validation",
        reason: "waiting_retry_gate",
      }
    );

    assertions.push(
      assertEqual(
        "F5-2 workflow remains running while waiting_retry exists",
        retrySummary.action,
        "still_running",
        "waiting_retry must block completion"
      )
    );

    await waitUntilRetryDue(String(retryActivity.next_retry_at));
    await runWorkerLoop(
      supabase,
      1,
      300,
      ["debug.fail_n_times_then_succeed"],
      false
    );

    const retryWorkflowFinal = await fetchWorkflowRun(supabase, retryRun.workflow_run_id);

    assertions.push(
      assertEqual(
        "F5-3 workflow completes after retry success",
        retryWorkflowFinal.status,
        "completed",
        "Workflow should finalize only after waiting_retry clears"
      )
    );

    const staleWorkflowKey = "validation.finalization.stale_recovery_gate";

    await ensureValidationWorkflow(
      supabase,
      staleWorkflowKey,
      "Validation: Finalization Stale Recovery Gate",
      [
        {
          key: "A",
          name: "Stale Recovery Gate",
          handler_key: "debug.noop",
          is_entry: true,
          is_terminal: true,
          is_optional: false,
          retry_max_attempts: 4,
          retry_backoff_seconds: 1,
          retry_backoff_multiplier: 1,
          execution_priority: 10,
        },
      ],
      []
    );

    const staleRun = await startWorkflowRunMaterialization(
      supabase,
      { definition_key: staleWorkflowKey },
      null
    );

    const seeded = await fetchActivityRunByKey(supabase, staleRun.workflow_run_id, "A");
    await simulateClaimForActivity(supabase, seeded.id, "phase8-stale-worker", 60);

    const claimed = await fetchActivityRunByKey(supabase, staleRun.workflow_run_id, "A");

    await ensureAttemptExists(
      supabase,
      claimed.id,
      staleRun.workflow_run_id,
      claimed.attempt_count,
      "phase8-stale-worker"
    );

    await markActivityRunningStale(supabase, claimed.id, "phase8-stale-worker");

    const recovery = await recoverStaleActivityRuns(supabase, {
      max_records: 10,
      dry_run: false,
      actor: "phase8-validation",
    });

    assertions.push(
      assert(
        "F5-4 stale running recovered to waiting_retry",
        recovery.recovered_to_waiting_retry_count >= 1,
        "Stale recovery should move abandoned running work into retry path",
        JSON.stringify(recovery)
      )
    );

    const staleSummary = await finalizeWorkflowRunState(
      supabase,
      staleRun.workflow_run_id,
      {
        actor: "phase8-validation",
        reason: "stale_recovery_gate",
      }
    );

    assertions.push(
      assertEqual(
        "F5-5 stale recovered waiting_retry keeps workflow running",
        staleSummary.action,
        "still_running",
        "Recovered waiting_retry must not allow premature completion"
      )
    );

    const staleAfterRecovery = await fetchActivityRunByKey(
      supabase,
      staleRun.workflow_run_id,
      "A"
    );

    await waitUntilRetryDue(String(staleAfterRecovery.next_retry_at));

    await runWorkerLoop(supabase, 1, 300, ["debug.noop"], false);

    const staleWorkflowFinal = await fetchWorkflowRun(supabase, staleRun.workflow_run_id);

    assertions.push(
      assertEqual(
        "F5-6 stale-recovered workflow eventually completes",
        staleWorkflowFinal.status,
        "completed",
        "Workflow should complete once recovered activity succeeds"
      )
    );
  } catch (error) {
    assertions.push(assert("F5 fatal", false, scenario, String(error)));
  }

  return {
    scenario,
    assertions,
    all_passed: assertions.every((a) => a.passed),
    summary: summarize(assertions),
  };
}

function printResults(results: ScenarioResult[]): void {
  console.log("\n" + "=".repeat(76));
  console.log("PHASE 8 VALIDATION: WORKFLOW COMPLETION AND FINALIZATION");
  console.log("=".repeat(76));

  for (const result of results) {
    console.log(`\n${result.scenario}`);
    console.log("-".repeat(76));

    for (const assertion of result.assertions) {
      const status = assertion.passed ? "PASS" : "FAIL";
      console.log(`[${status}] ${assertion.name}`);
      if (!assertion.passed && assertion.error) {
        console.log(`  Error: ${assertion.error}`);
      }
    }

    console.log(`Summary: ${result.summary}`);
    console.log(`Status: ${result.all_passed ? "ALL PASSED" : "HAS FAILURES"}`);
  }

  const passedScenarios = results.filter((r) => r.all_passed).length;

  console.log("\n" + "=".repeat(76));
  console.log(`OVERALL: ${passedScenarios}/${results.length} scenarios fully passed`);
  console.log("=".repeat(76) + "\n");
}

async function main() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    Deno.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const results: ScenarioResult[] = [];
  results.push(await validateSimpleCompletionAndIdempotency(supabase));
  results.push(await validateFanInCompletionGating(supabase));
  results.push(await validateRequiredFailureFinalization(supabase));
  results.push(await validateOptionalFailureNonBlocking(supabase));
  results.push(await validateRetryAndStaleRecoveryGating(supabase));

  printResults(results);

  Deno.exit(results.every((r) => r.all_passed) ? 0 : 1);
}

main();
