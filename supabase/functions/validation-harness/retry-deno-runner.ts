// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { startWorkflowRunMaterialization } from "../workflow-start/materialization-service.ts";
import { runWorkerLoop } from "../workflow-worker/worker-loop.ts";

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
      `Failed to upsert workflow definition version for ${key}: ${upsertVersionError.message}`
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
      `Failed to resolve workflow definition version for ${key}: ${versionError?.message ?? "not found"}`
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

  const { error: upsertActivityError } = await supabase
    .from("workflow_activities")
    .upsert(activityRows, { onConflict: "version_id,key" });

  if (upsertActivityError) {
    throw new Error(
      `Failed to upsert workflow activities for ${key}: ${upsertActivityError.message}`
    );
  }

  const { data: activityRecords, error: activityRecordsError } = await supabase
    .from("workflow_activities")
    .select("id, key")
    .eq("version_id", version.id);

  if (activityRecordsError || !activityRecords) {
    throw new Error(
      `Failed to load workflow activities for ${key}: ${activityRecordsError?.message ?? "not found"}`
    );
  }

  const activityIdByKey = new Map(activityRecords.map((a) => [a.key, a.id]));

  if (edges.length > 0) {
    const edgeRows = edges.map((edge) => {
      const fromId = activityIdByKey.get(edge.from_key);
      const toId = activityIdByKey.get(edge.to_key);

      if (!fromId || !toId) {
        throw new Error(
          `Invalid edge seed for ${key}: ${edge.from_key} -> ${edge.to_key}`
        );
      }

      return {
        version_id: version.id,
        from_activity_id: fromId,
        to_activity_id: toId,
        join_policy: "all",
        created_at: nowIso,
      };
    });

    const { error: upsertEdgeError } = await supabase
      .from("workflow_edges")
      .upsert(edgeRows, { onConflict: "from_activity_id,to_activity_id" });

    if (upsertEdgeError) {
      throw new Error(
        `Failed to upsert workflow edges for ${key}: ${upsertEdgeError.message}`
      );
    }
  }

  return {
    definitionId: definition.id,
    versionId: version.id,
  };
}

async function fetchActivityRunByKey(
  supabase: ReturnType<typeof createClient>,
  workflowRunId: string,
  activityKey: string
) {
  const { data, error } = await supabase
    .from("activity_runs")
    .select(
      "id, activity_key, status, attempt_count, max_attempts, next_retry_at, error_message, error_details, output_payload, is_optional"
    )
    .eq("workflow_run_id", workflowRunId)
    .eq("activity_key", activityKey)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to load activity_run ${activityKey}: ${error?.message ?? "not found"}`
    );
  }

  return data;
}

async function fetchWorkflowRunStatus(
  supabase: ReturnType<typeof createClient>,
  workflowRunId: string
): Promise<string> {
  const { data, error } = await supabase
    .from("workflow_runs")
    .select("status")
    .eq("id", workflowRunId)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to load workflow_run status: ${error?.message ?? "not found"}`
    );
  }

  return data.status;
}

async function fetchAttempts(
  supabase: ReturnType<typeof createClient>,
  activityRunId: string
) {
  const { data, error } = await supabase
    .from("activity_attempts")
    .select("attempt_number, started_at, finished_at, error_message, error_details, output_payload, duration_ms")
    .eq("activity_run_id", activityRunId)
    .order("attempt_number", { ascending: true });

  if (error || !data) {
    throw new Error(
      `Failed to load activity_attempts: ${error?.message ?? "not found"}`
    );
  }

  return data;
}

async function validateRetryThenRecover(
  supabase: ReturnType<typeof createClient>
): Promise<ScenarioResult> {
  const assertions: AssertionResult[] = [];
  const scenario = "R1: Retryable failures eventually recover";

  try {
    const workflowKey = "validation.retry.recover_required";

    await ensureValidationWorkflow(
      supabase,
      workflowKey,
      "Validation: Retry Recover Required",
      [
        {
          key: "A",
          name: "Retryable Task",
          handler_key: "debug.fail_n_times_then_succeed",
          is_entry: true,
          is_terminal: true,
          is_optional: false,
          retry_max_attempts: 5,
          retry_backoff_seconds: 1,
          retry_backoff_multiplier: 1,
          execution_priority: 10,
        },
      ],
      []
    );

    const run = await startWorkflowRunMaterialization(
      supabase,
      {
        definition_key: workflowKey,
        input_payload: {
          fail_times: 2,
        },
      },
      null
    );

    const workflowRunId = run.workflow_run_id;

    await runWorkerLoop(
      supabase,
      1,
      300,
      ["debug.fail_n_times_then_succeed"],
      false
    );

    const afterFirst = await fetchActivityRunByKey(supabase, workflowRunId, "A");

    assertions.push(
      assertEqual(
        "R1-1 status after first attempt",
        afterFirst.status,
        "waiting_retry",
        "Retryable failure should move to waiting_retry"
      )
    );

    assertions.push(
      assert(
        "R1-2 next_retry_at is set",
        typeof afterFirst.next_retry_at === "string" && afterFirst.next_retry_at.length > 0,
        "next_retry_at should be computed",
        `next_retry_at=${afterFirst.next_retry_at}`
      )
    );

    const firstDelaySeconds =
      (new Date(afterFirst.next_retry_at).getTime() - Date.now()) / 1000;
    assertions.push(
      assert(
        "R1-2b next_retry_at uses configured backoff window",
        firstDelaySeconds > 0 && firstDelaySeconds <= 3,
        "First retry should be scheduled with ~1 second backoff",
        `delay_seconds=${firstDelaySeconds}`
      )
    );

    assertions.push(
      assertEqual(
        "R1-3 attempt_count increments on claim",
        afterFirst.attempt_count,
        1,
        "First claim should set attempt_count to 1"
      )
    );

    assertions.push(
      assertEqual(
        "R1-4 workflow remains running during retries",
        await fetchWorkflowRunStatus(supabase, workflowRunId),
        "running",
        "Workflow should not fail while retries remain"
      )
    );

    await waitUntilRetryDue(afterFirst.next_retry_at);

    await runWorkerLoop(
      supabase,
      1,
      300,
      ["debug.fail_n_times_then_succeed"],
      false
    );

    const afterSecond = await fetchActivityRunByKey(supabase, workflowRunId, "A");

    assertions.push(
      assertEqual(
        "R1-5 status after second retryable failure",
        afterSecond.status,
        "waiting_retry",
        "Activity should remain waiting_retry before max attempts"
      )
    );

    assertions.push(
      assertEqual(
        "R1-6 attempt_count increments for second claim",
        afterSecond.attempt_count,
        2,
        "Second claim should set attempt_count to 2"
      )
    );

    const secondDelaySeconds =
      (new Date(afterSecond.next_retry_at).getTime() - Date.now()) / 1000;
    assertions.push(
      assert(
        "R1-6b second retry retains deterministic backoff",
        secondDelaySeconds > 0 && secondDelaySeconds <= 3,
        "Second retry should keep ~1 second backoff for multiplier=1",
        `delay_seconds=${secondDelaySeconds}`
      )
    );

    await waitUntilRetryDue(afterSecond.next_retry_at);

    await runWorkerLoop(
      supabase,
      1,
      300,
      ["debug.fail_n_times_then_succeed"],
      false
    );

    const finalActivity = await fetchActivityRunByKey(supabase, workflowRunId, "A");

    assertions.push(
      assertEqual(
        "R1-7 activity eventually succeeds",
        finalActivity.status,
        "completed",
        "Activity should succeed after configured failure count"
      )
    );

    assertions.push(
      assertEqual(
        "R1-8 workflow completes after recovery",
        await fetchWorkflowRunStatus(supabase, workflowRunId),
        "completed",
        "Workflow should complete after final success"
      )
    );

    const attempts = await fetchAttempts(supabase, finalActivity.id);

    assertions.push(
      assertEqual(
        "R1-9 attempt history row count",
        attempts.length,
        3,
        "Three attempts expected (2 failures + 1 success)"
      )
    );

    assertions.push(
      assert(
        "R1-10 taxonomy category persisted on failed attempts",
        attempts.slice(0, 2).every((a) => {
          const details = a.error_details as Record<string, unknown> | null;
          return details?.category === "transient";
        }),
        "Failed attempts should persist transient category diagnostics",
        JSON.stringify(attempts.slice(0, 2).map((a) => a.error_details))
      )
    );
  } catch (error) {
    assertions.push(
      assert(
        "R1 fatal",
        false,
        scenario,
        String(error)
      )
    );
  }

  return {
    scenario,
    assertions,
    all_passed: assertions.every((a) => a.passed),
    summary: summarize(assertions),
  };
}

async function validateTerminalRequiredFailure(
  supabase: ReturnType<typeof createClient>
): Promise<ScenarioResult> {
  const assertions: AssertionResult[] = [];
  const scenario = "R2: Required terminal failure fails workflow";

  try {
    const workflowKey = "validation.retry.required_terminal";

    await ensureValidationWorkflow(
      supabase,
      workflowKey,
      "Validation: Required Terminal Failure",
      [
        {
          key: "A",
          name: "Required Terminal Failure",
          handler_key: "debug.fail_terminal",
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

    const run = await startWorkflowRunMaterialization(
      supabase,
      {
        definition_key: workflowKey,
      },
      null
    );

    const workflowRunId = run.workflow_run_id;

    await runWorkerLoop(
      supabase,
      1,
      300,
      ["debug.fail_terminal"],
      false
    );

    const activity = await fetchActivityRunByKey(supabase, workflowRunId, "A");

    assertions.push(
      assertEqual(
        "R2-1 terminal failure status",
        activity.status,
        "failed",
        "Terminal failure should move activity to failed"
      )
    );

    assertions.push(
      assertEqual(
        "R2-2 no waiting_retry on terminal failure",
        activity.next_retry_at,
        null,
        "Terminal failure should not schedule retry"
      )
    );

    assertions.push(
      assertEqual(
        "R2-3 required terminal failure fails workflow",
        await fetchWorkflowRunStatus(supabase, workflowRunId),
        "failed",
        "Required terminal failure should fail workflow immediately"
      )
    );

    const attempts = await fetchAttempts(supabase, activity.id);

    assertions.push(
      assertEqual(
        "R2-4 exactly one attempt is recorded",
        attempts.length,
        1,
        "Terminal failure should finish on first attempt"
      )
    );

    assertions.push(
      assert(
        "R2-5 taxonomy category is permanent",
        ((attempts[0]?.error_details as Record<string, unknown> | null)?.category) ===
          "permanent",
        "Terminal debug handler should persist permanent category",
        JSON.stringify(attempts[0]?.error_details)
      )
    );
  } catch (error) {
    assertions.push(
      assert(
        "R2 fatal",
        false,
        scenario,
        String(error)
      )
    );
  }

  return {
    scenario,
    assertions,
    all_passed: assertions.every((a) => a.passed),
    summary: summarize(assertions),
  };
}

async function validateTerminalOptionalFailure(
  supabase: ReturnType<typeof createClient>
): Promise<ScenarioResult> {
  const assertions: AssertionResult[] = [];
  const scenario = "R3: Optional terminal failure does not fail workflow";

  try {
    const workflowKey = "validation.retry.optional_terminal";

    await ensureValidationWorkflow(
      supabase,
      workflowKey,
      "Validation: Optional Terminal Failure",
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
          name: "Optional Terminal Failure",
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
      {
        definition_key: workflowKey,
      },
      null
    );

    const workflowRunId = run.workflow_run_id;

    await runWorkerLoop(
      supabase,
      2,
      300,
      ["debug.noop", "debug.fail_terminal"],
      false
    );

    const required = await fetchActivityRunByKey(supabase, workflowRunId, "REQ");
    const optional = await fetchActivityRunByKey(supabase, workflowRunId, "OPT");

    assertions.push(
      assertEqual(
        "R3-1 required activity completes",
        required.status,
        "completed",
        "Required activity should complete"
      )
    );

    assertions.push(
      assertEqual(
        "R3-2 optional activity can fail terminally",
        optional.status,
        "failed",
        "Optional activity should fail terminally"
      )
    );

    assertions.push(
      assertEqual(
        "R3-3 workflow still completes when only optional failed",
        await fetchWorkflowRunStatus(supabase, workflowRunId),
        "completed",
        "Optional failure should not fail workflow when required work completed"
      )
    );
  } catch (error) {
    assertions.push(
      assert(
        "R3 fatal",
        false,
        scenario,
        String(error)
      )
    );
  }

  return {
    scenario,
    assertions,
    all_passed: assertions.every((a) => a.passed),
    summary: summarize(assertions),
  };
}

function printResults(results: ScenarioResult[]): void {
  console.log("\n" + "=".repeat(72));
  console.log("PHASE 6 VALIDATION: RETRY ENGINE AND FAILURE POLICY");
  console.log("=".repeat(72));

  for (const result of results) {
    console.log(`\n${result.scenario}`);
    console.log("-".repeat(72));

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
  console.log("\n" + "=".repeat(72));
  console.log(`OVERALL: ${passedScenarios}/${results.length} scenarios fully passed`);
  console.log("=".repeat(72) + "\n");
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
  results.push(await validateRetryThenRecover(supabase));
  results.push(await validateTerminalRequiredFailure(supabase));
  results.push(await validateTerminalOptionalFailure(supabase));

  printResults(results);

  Deno.exit(results.every((r) => r.all_passed) ? 0 : 1);
}

main();
