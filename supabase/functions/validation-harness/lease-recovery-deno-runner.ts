// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { startWorkflowRunMaterialization } from "../workflow-start/materialization-service.ts";
import { runWorkerLoop } from "../workflow-worker/worker-loop.ts";
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
    throw new Error(
      `Simulated claim did not update activity ${activityRunId}; expected queued status`
    );
  }
}

async function fetchActivityRunByKey(
  supabase: ReturnType<typeof createClient>,
  workflowRunId: string,
  activityKey: string
) {
  const { data, error } = await supabase
    .from("activity_runs")
    .select(
      "id, workflow_run_id, activity_id, activity_key, status, attempt_count, max_attempts, is_optional, next_retry_at, claimed_by, claimed_at, started_at, lease_expires_at, error_message, error_details"
    )
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

async function fetchWorkflowStatus(
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
      `Failed to load workflow status: ${error?.message ?? "not found"}`
    );
  }

  return data.status;
}

async function fetchAttemptRows(
  supabase: ReturnType<typeof createClient>,
  activityRunId: string
) {
  const { data, error } = await supabase
    .from("activity_attempts")
    .select(
      "id, attempt_number, claimed_at, started_at, finished_at, error_message, error_details, duration_ms"
    )
    .eq("activity_run_id", activityRunId)
    .order("attempt_number", { ascending: true });

  if (error || !data) {
    throw new Error(
      `Failed to load attempt rows: ${error?.message ?? "not found"}`
    );
  }

  return data;
}

async function expireLeaseForActivity(
  supabase: ReturnType<typeof createClient>,
  activityRunId: string,
  secondsAgo: number = 30
): Promise<void> {
  const pastIso = new Date(Date.now() - secondsAgo * 1000).toISOString();
  const { error } = await supabase
    .from("activity_runs")
    .update({
      lease_expires_at: pastIso,
      updated_at: new Date().toISOString(),
    })
    .eq("id", activityRunId);

  if (error) {
    throw new Error(`Failed to expire lease for ${activityRunId}: ${error.message}`);
  }
}

async function markActivityRunningStale(
  supabase: ReturnType<typeof createClient>,
  activityRunId: string,
  workerId: string,
  secondsAgo: number = 30
): Promise<void> {
  const now = Date.now();
  const claimedIso = new Date(now - (secondsAgo + 5) * 1000).toISOString();
  const startedIso = new Date(now - secondsAgo * 1000).toISOString();
  const leaseIso = new Date(now - 1000).toISOString();

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
    throw new Error(`Failed to mark running stale for ${activityRunId}: ${error.message}`);
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
    throw new Error(
      `Failed to ensure attempt row ${attemptNumber} for ${activityRunId}: ${error.message}`
    );
  }
}

async function countActivityRuns(
  supabase: ReturnType<typeof createClient>,
  workflowRunId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("activity_runs")
    .select("id", { count: "exact", head: true })
    .eq("workflow_run_id", workflowRunId);

  if (error) {
    throw new Error(`Failed to count activity_runs: ${error.message}`);
  }

  return count ?? 0;
}

async function fetchRecoveryEvents(
  supabase: ReturnType<typeof createClient>,
  activityRunId: string
) {
  const { data, error } = await supabase
    .from("workflow_events")
    .select("event_type, details")
    .eq("activity_run_id", activityRunId)
    .in("event_type", ["activity_failed", "activity_retrying", "workflow_failed"])
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load recovery events: ${error.message}`);
  }

  return data ?? [];
}

async function validateStaleClaimedRecovery(
  supabase: ReturnType<typeof createClient>
): Promise<ScenarioResult> {
  const scenario = "L1: stale claimed recovered to queued and reprocessed";
  const assertions: AssertionResult[] = [];

  try {
    const workflowKey = "validation.lease.claimed.basic";

    await ensureValidationWorkflow(
      supabase,
      workflowKey,
      "Validation: Lease Claimed Recovery",
      [
        {
          key: "A",
          name: "Claimed Recovery",
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
      {
        definition_key: workflowKey,
      },
      null
    );

    const workflowRunId = run.workflow_run_id;

    const seededActivity = await fetchActivityRunByKey(supabase, workflowRunId, "A");
    await simulateClaimForActivity(
      supabase,
      seededActivity.id,
      "phase7-claimed-crash",
      60
    );
    await expireLeaseForActivity(supabase, seededActivity.id, 40);

    const beforeDryRun = await fetchActivityRunByKey(supabase, workflowRunId, "A");
    assertions.push(
      assertEqual(
        "L1-1 claimed before recovery",
        beforeDryRun.status,
        "claimed",
        "Activity should be stale claimed before recovery"
      )
    );

    const dryRun = await recoverStaleActivityRuns(supabase, {
      dry_run: true,
      max_records: 10,
      actor: "phase7-validation",
    });

    assertions.push(
      assert(
        "L1-2 dry run finds stale activity",
        dryRun.stale_found_count >= 1,
        "Dry run should detect stale claimed activity",
        JSON.stringify(dryRun)
      )
    );

    const afterDryRun = await fetchActivityRunByKey(supabase, workflowRunId, "A");
    assertions.push(
      assertEqual(
        "L1-3 dry run does not mutate status",
        afterDryRun.status,
        "claimed",
        "Dry run must not mutate activity status"
      )
    );

    const recovery = await recoverStaleActivityRuns(supabase, {
      dry_run: false,
      max_records: 10,
      actor: "phase7-validation",
    });

    assertions.push(
      assert(
        "L1-4 recovered_to_queued_count increments",
        recovery.recovered_to_queued_count >= 1,
        "Stale claimed should be recovered to queued",
        JSON.stringify(recovery)
      )
    );

    const afterRecovery = await fetchActivityRunByKey(supabase, workflowRunId, "A");
    assertions.push(
      assertEqual(
        "L1-5 status recovered to queued",
        afterRecovery.status,
        "queued",
        "Stale claimed should become queued"
      )
    );

    assertions.push(
      assertEqual(
        "L1-6 lease cleared on recovery",
        afterRecovery.lease_expires_at,
        null,
        "Recovered queued activity should have lease cleared"
      )
    );

    assertions.push(
      assertEqual(
        "L1-7 no duplicate activity_runs",
        await countActivityRuns(supabase, workflowRunId),
        1,
        "Recovery must not create duplicate activity_runs"
      )
    );

    await runWorkerLoop(supabase, 1, 300, ["debug.noop"], false);

    const finalActivity = await fetchActivityRunByKey(supabase, workflowRunId, "A");
    assertions.push(
      assertEqual(
        "L1-8 recovered work is claimable and completes",
        finalActivity.status,
        "completed",
        "Recovered queued work should complete on next worker run"
      )
    );

    assertions.push(
      assertEqual(
        "L1-9 workflow completes",
        await fetchWorkflowStatus(supabase, workflowRunId),
        "completed",
        "Workflow should complete after recovered work finishes"
      )
    );

    const events = await fetchRecoveryEvents(supabase, seededActivity.id);
    assertions.push(
      assert(
        "L1-10 recovery event details present",
        events.some((e) => {
          const details = e.details as Record<string, unknown> | null;
          return details?.recovery_reason === "stale_claimed_lease_expired";
        }),
        "Recovery events should include stale claimed reason",
        JSON.stringify(events)
      )
    );
  } catch (error) {
    assertions.push(
      assert("L1 fatal", false, scenario, String(error))
    );
  }

  return {
    scenario,
    assertions,
    all_passed: assertions.every((a) => a.passed),
    summary: summarize(assertions),
  };
}

async function validateStaleRunningRecovery(
  supabase: ReturnType<typeof createClient>
): Promise<ScenarioResult> {
  const scenario = "L2: stale running recovered to waiting_retry and reprocessed";
  const assertions: AssertionResult[] = [];

  try {
    const workflowKey = "validation.lease.running.retry";

    await ensureValidationWorkflow(
      supabase,
      workflowKey,
      "Validation: Lease Running Recovery",
      [
        {
          key: "A",
          name: "Running Recovery",
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

    const run = await startWorkflowRunMaterialization(
      supabase,
      {
        definition_key: workflowKey,
      },
      null
    );

    const workflowRunId = run.workflow_run_id;

    const activityBeforeQueued = await fetchActivityRunByKey(supabase, workflowRunId, "A");
    await simulateClaimForActivity(
      supabase,
      activityBeforeQueued.id,
      "phase7-running-crash",
      60
    );

    const activityBefore = await fetchActivityRunByKey(supabase, workflowRunId, "A");

    await ensureAttemptExists(
      supabase,
      activityBefore.id,
      workflowRunId,
      activityBefore.attempt_count,
      "phase7-running-crash"
    );

    await markActivityRunningStale(
      supabase,
      activityBefore.id,
      "phase7-running-crash",
      35
    );

    const recovery = await recoverStaleActivityRuns(supabase, {
      dry_run: false,
      max_records: 10,
      actor: "phase7-validation",
    });

    assertions.push(
      assert(
        "L2-1 recovered_to_waiting_retry_count increments",
        recovery.recovered_to_waiting_retry_count >= 1,
        "Stale running should recover to waiting_retry",
        JSON.stringify(recovery)
      )
    );

    const afterRecovery = await fetchActivityRunByKey(supabase, workflowRunId, "A");

    assertions.push(
      assertEqual(
        "L2-2 status waiting_retry",
        afterRecovery.status,
        "waiting_retry",
        "Stale running should move to waiting_retry"
      )
    );

    assertions.push(
      assert(
        "L2-3 next_retry_at computed",
        typeof afterRecovery.next_retry_at === "string" && afterRecovery.next_retry_at.length > 0,
        "waiting_retry must include next_retry_at",
        `next_retry_at=${afterRecovery.next_retry_at}`
      )
    );

    const attemptsAfterRecovery = await fetchAttemptRows(supabase, afterRecovery.id);
    assertions.push(
      assert(
        "L2-4 abandoned attempt closed with diagnostics",
        attemptsAfterRecovery.length >= 1 &&
          attemptsAfterRecovery[0].finished_at !== null &&
          ((attemptsAfterRecovery[0].error_details as Record<string, unknown> | null)
            ?.recovery_reason === "stale_running_lease_expired"),
        "Recovered running attempt should be closed and tagged",
        JSON.stringify(attemptsAfterRecovery)
      )
    );

    await waitUntilRetryDue(afterRecovery.next_retry_at);

    await runWorkerLoop(supabase, 1, 300, ["debug.noop"], false);

    const finalActivity = await fetchActivityRunByKey(supabase, workflowRunId, "A");

    assertions.push(
      assertEqual(
        "L2-5 recovered running work can complete later",
        finalActivity.status,
        "completed",
        "Recovered waiting_retry work should complete on subsequent worker run"
      )
    );

    const finalAttempts = await fetchAttemptRows(supabase, finalActivity.id);
    assertions.push(
      assert(
        "L2-6 new attempt row created on re-run",
        finalAttempts.length >= 2 && finalAttempts.some((a) => a.attempt_number >= 2),
        "Re-run should create a new attempt row",
        JSON.stringify(finalAttempts)
      )
    );

    assertions.push(
      assertEqual(
        "L2-7 workflow completes",
        await fetchWorkflowStatus(supabase, workflowRunId),
        "completed",
        "Workflow should complete after recovered running activity finishes"
      )
    );
  } catch (error) {
    assertions.push(
      assert("L2 fatal", false, scenario, String(error))
    );
  }

  return {
    scenario,
    assertions,
    all_passed: assertions.every((a) => a.passed),
    summary: summarize(assertions),
  };
}

async function validateRequiredExhaustedFailure(
  supabase: ReturnType<typeof createClient>
): Promise<ScenarioResult> {
  const scenario = "L3: exhausted stale required work terminally fails workflow";
  const assertions: AssertionResult[] = [];

  try {
    const workflowKey = "validation.lease.required.exhausted";

    await ensureValidationWorkflow(
      supabase,
      workflowKey,
      "Validation: Lease Required Exhausted",
      [
        {
          key: "A",
          name: "Required Exhausted",
          handler_key: "debug.noop",
          is_entry: true,
          is_terminal: true,
          is_optional: false,
          retry_max_attempts: 1,
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
    const activityBeforeQueued = await fetchActivityRunByKey(supabase, workflowRunId, "A");
    await simulateClaimForActivity(
      supabase,
      activityBeforeQueued.id,
      "phase7-required-exhausted",
      60
    );

    const activityBefore = await fetchActivityRunByKey(supabase, workflowRunId, "A");
    await ensureAttemptExists(
      supabase,
      activityBefore.id,
      workflowRunId,
      activityBefore.attempt_count,
      "phase7-required-exhausted"
    );

    await markActivityRunningStale(
      supabase,
      activityBefore.id,
      "phase7-required-exhausted",
      45
    );

    const recovery = await recoverStaleActivityRuns(supabase, {
      dry_run: false,
      max_records: 10,
      actor: "phase7-validation",
    });

    assertions.push(
      assert(
        "L3-1 terminal failed_count increments",
        recovery.failed_count >= 1,
        "Exhausted stale running activity should fail terminally",
        JSON.stringify(recovery)
      )
    );

    const finalActivity = await fetchActivityRunByKey(supabase, workflowRunId, "A");
    assertions.push(
      assertEqual(
        "L3-2 activity terminally failed",
        finalActivity.status,
        "failed",
        "Exhausted recovery must fail terminally"
      )
    );

    assertions.push(
      assertEqual(
        "L3-3 required activity failure fails workflow",
        await fetchWorkflowStatus(supabase, workflowRunId),
        "failed",
        "Required terminal failure must fail workflow"
      )
    );

    assertions.push(
      assertEqual(
        "L3-4 no duplicate activity_runs",
        await countActivityRuns(supabase, workflowRunId),
        1,
        "Recovery must not duplicate activity rows"
      )
    );

    const attempts = await fetchAttemptRows(supabase, finalActivity.id);
    assertions.push(
      assert(
        "L3-5 attempt history keeps recovery diagnostics",
        attempts.length >= 1 &&
          ((attempts[0].error_details as Record<string, unknown> | null)?.recovery_reason ===
            "retry_budget_exhausted"),
        "Attempt should preserve retry budget exhausted diagnostics",
        JSON.stringify(attempts)
      )
    );
  } catch (error) {
    assertions.push(
      assert("L3 fatal", false, scenario, String(error))
    );
  }

  return {
    scenario,
    assertions,
    all_passed: assertions.every((a) => a.passed),
    summary: summarize(assertions),
  };
}

async function validateOptionalExhaustedFailure(
  supabase: ReturnType<typeof createClient>
): Promise<ScenarioResult> {
  const scenario = "L4: exhausted optional stale work does not immediately fail workflow";
  const assertions: AssertionResult[] = [];

  try {
    const workflowKey = "validation.lease.optional.exhausted";

    await ensureValidationWorkflow(
      supabase,
      workflowKey,
      "Validation: Lease Optional Exhausted",
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
          name: "Optional Exhausted",
          handler_key: "debug.noop",
          is_entry: true,
          is_terminal: true,
          is_optional: true,
          retry_max_attempts: 1,
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

    await runWorkerLoop(supabase, 1, 300, ["debug.noop"], false);

    const required = await fetchActivityRunByKey(supabase, workflowRunId, "REQ");
    assertions.push(
      assertEqual(
        "L4-1 required activity completed before optional recovery",
        required.status,
        "completed",
        "Required work should complete first"
      )
    );

    const optionalQueued = await fetchActivityRunByKey(supabase, workflowRunId, "OPT");
    await simulateClaimForActivity(
      supabase,
      optionalQueued.id,
      "phase7-optional-exhausted",
      60
    );

    const optional = await fetchActivityRunByKey(supabase, workflowRunId, "OPT");
    await ensureAttemptExists(
      supabase,
      optional.id,
      workflowRunId,
      optional.attempt_count,
      "phase7-optional-exhausted"
    );
    await markActivityRunningStale(
      supabase,
      optional.id,
      "phase7-optional-exhausted",
      45
    );

    const recovery = await recoverStaleActivityRuns(supabase, {
      dry_run: false,
      max_records: 10,
      actor: "phase7-validation",
    });

    assertions.push(
      assert(
        "L4-2 optional terminal failure counted",
        recovery.failed_count >= 1,
        "Optional exhausted stale activity should fail terminally",
        JSON.stringify(recovery)
      )
    );

    const optionalFinal = await fetchActivityRunByKey(supabase, workflowRunId, "OPT");
    assertions.push(
      assertEqual(
        "L4-3 optional activity failed",
        optionalFinal.status,
        "failed",
        "Optional stale exhausted work should be failed"
      )
    );

    assertions.push(
      assertEqual(
        "L4-4 workflow completes despite optional terminal failure",
        await fetchWorkflowStatus(supabase, workflowRunId),
        "completed",
        "Optional failure should not fail workflow when required work is done"
      )
    );

    const events = await fetchRecoveryEvents(supabase, optional.id);
    assertions.push(
      assert(
        "L4-5 recovery details present in events",
        events.some((e) => {
          const details = e.details as Record<string, unknown> | null;
          const nested = details?.error_details as Record<string, unknown> | undefined;
          return (
            details?.reason === "required_activity_terminal_failure" ||
            nested?.recovery_reason === "retry_budget_exhausted"
          );
        }),
        "Recovery-related details should be persisted in workflow events",
        JSON.stringify(events)
      )
    );
  } catch (error) {
    assertions.push(
      assert("L4 fatal", false, scenario, String(error))
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
  console.log("\n" + "=".repeat(74));
  console.log("PHASE 7 VALIDATION: LEASE RECOVERY AND STUCK-WORK CLEANUP");
  console.log("=".repeat(74));

  for (const result of results) {
    console.log(`\n${result.scenario}`);
    console.log("-".repeat(74));

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

  console.log("\n" + "=".repeat(74));
  console.log(`OVERALL: ${passedScenarios}/${results.length} scenarios fully passed`);
  console.log("=".repeat(74) + "\n");
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
  results.push(await validateStaleClaimedRecovery(supabase));
  results.push(await validateStaleRunningRecovery(supabase));
  results.push(await validateRequiredExhaustedFailure(supabase));
  results.push(await validateOptionalExhaustedFailure(supabase));

  printResults(results);

  Deno.exit(results.every((r) => r.all_passed) ? 0 : 1);
}

main();
