// @ts-nocheck
/**
 * Phase 5 — Stale workflow-run detection validation.
 *
 * Seeds a minimal workflow_run + entry activity_run, backdates their
 * updated_at past the stale window, then invokes workflow-maintenance
 * (in-process) and asserts that:
 *   - dry_run reports the stale workflow without mutating state
 *   - a real run flips workflow_runs → failed with
 *     failure_reason='stale_workflow_no_activity'
 *   - in-progress activity_runs are marked failed with the recovery_action
 *   - a workflow_failed event is logged
 *   - fresh / recently-updated workflows are not touched
 *
 * Usage:
 *   deno run --allow-net --allow-env \
 *     supabase/functions/validation-harness/stale-workflow-deno-runner.ts
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

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

function assert(name: string, condition: boolean, message: string, error?: string): AssertionResult {
  return { name, passed: condition, message, error: condition ? undefined : error };
}

function assertEqual(name: string, actual: unknown, expected: unknown, message: string): AssertionResult {
  const passed = actual === expected;
  return {
    name,
    passed,
    message,
    error: passed ? undefined : `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  };
}

function summarize(assertions: AssertionResult[]): string {
  const passed = assertions.filter((a) => a.passed).length;
  return `${passed}/${assertions.length} passed`;
}

const WORKFLOW_KEY = "validation.stale.workflow.basic";

async function ensureDefinition(supabase: ReturnType<typeof createClient>) {
  const nowIso = new Date().toISOString();

  await supabase
    .from("workflow_definitions")
    .upsert(
      { key: WORKFLOW_KEY, name: "Validation: Stale Workflow", status: "active", updated_at: nowIso },
      { onConflict: "key" }
    );

  const { data: def, error: defErr } = await supabase
    .from("workflow_definitions")
    .select("id")
    .eq("key", WORKFLOW_KEY)
    .single();
  if (defErr || !def) throw new Error(`load definition: ${defErr?.message}`);

  await supabase
    .from("workflow_definition_versions")
    .upsert(
      {
        workflow_definition_id: def.id,
        version: 1,
        is_current: true,
        default_context: {},
      },
      { onConflict: "workflow_definition_id,version" }
    );

  const { data: ver, error: verErr } = await supabase
    .from("workflow_definition_versions")
    .select("id")
    .eq("workflow_definition_id", def.id)
    .eq("version", 1)
    .single();
  if (verErr || !ver) throw new Error(`load version: ${verErr?.message}`);

  await supabase
    .from("workflow_activities")
    .upsert(
      [
        {
          version_id: ver.id,
          key: "A",
          name: "Stale Probe",
          handler_key: "debug.noop",
          is_entry: true,
          is_terminal: true,
          is_optional: false,
          retry_max_attempts: 1,
          retry_backoff_seconds: 1,
          retry_backoff_multiplier: 1,
          execution_priority: 10,
          created_at: nowIso,
        },
      ],
      { onConflict: "version_id,key" }
    );

  const { data: act, error: actErr } = await supabase
    .from("workflow_activities")
    .select("id")
    .eq("version_id", ver.id)
    .eq("key", "A")
    .single();
  if (actErr || !act) throw new Error(`load activity: ${actErr?.message}`);

  return { definitionId: def.id, versionId: ver.id, activityId: act.id };
}

async function seedStaleRun(
  supabase: ReturnType<typeof createClient>,
  ids: { definitionId: string; versionId: string; activityId: string },
  ageMinutes: number
): Promise<{ workflowRunId: string; activityRunId: string }> {
  const pastIso = new Date(Date.now() - ageMinutes * 60_000).toISOString();

  const { data: wr, error: wrErr } = await supabase
    .from("workflow_runs")
    .insert({
      workflow_definition_id: ids.definitionId,
      version_id: ids.versionId,
      status: "running",
      context: {},
      input_payload: {},
      user_id: null,
      created_at: pastIso,
      updated_at: pastIso,
    })
    .select("id")
    .single();
  if (wrErr || !wr) throw new Error(`seed workflow_run: ${wrErr?.message}`);

  const { data: ar, error: arErr } = await supabase
    .from("activity_runs")
    .insert({
      workflow_run_id: wr.id,
      activity_id: ids.activityId,
      activity_key: "A",
      status: "running",
      attempt_count: 1,
      max_attempts: 1,
      is_optional: false,
      claimed_by: "stale-test",
      claimed_at: pastIso,
      started_at: pastIso,
      lease_expires_at: pastIso,
      created_at: pastIso,
      updated_at: pastIso,
    })
    .select("id")
    .single();
  if (arErr || !ar) throw new Error(`seed activity_run: ${arErr?.message}`);

  // Re-backdate in case insert triggers refreshed updated_at.
  await supabase
    .from("workflow_runs")
    .update({ updated_at: pastIso, created_at: pastIso })
    .eq("id", wr.id);
  await supabase
    .from("activity_runs")
    .update({ updated_at: pastIso })
    .eq("id", ar.id);

  return { workflowRunId: wr.id, activityRunId: ar.id };
}

async function invokeMaintenance(
  supabaseUrl: string,
  serviceRoleKey: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${supabaseUrl}/functions/v1/workflow-maintenance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`workflow-maintenance ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function cleanup(supabase: ReturnType<typeof createClient>, workflowRunId: string) {
  // Phase 2 trigger has no entity to sync (user_id null, no trigger_entity_id).
  await supabase.from("workflow_events").delete().eq("workflow_run_id", workflowRunId);
  await supabase.from("activity_attempts").delete().eq("workflow_run_id", workflowRunId);
  await supabase.from("activity_runs").delete().eq("workflow_run_id", workflowRunId);
  await supabase.from("workflow_runs").delete().eq("id", workflowRunId);
}

async function validateStaleDetected(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceRoleKey: string,
  ids: { definitionId: string; versionId: string; activityId: string }
): Promise<ScenarioResult> {
  const scenario = "S1: stale workflow (20 min idle) flips to failed";
  const assertions: AssertionResult[] = [];
  let workflowRunId: string | undefined;

  try {
    const seeded = await seedStaleRun(supabase, ids, 20);
    workflowRunId = seeded.workflowRunId;

    // Dry-run pass: should detect but not mutate.
    const dryResp = await invokeMaintenance(supabaseUrl, serviceRoleKey, {
      dry_run: true,
      stale_workflow_minutes: 10,
      max_records: 100,
      actor: "phase5-validation",
    });

    assertions.push(
      assert(
        "S1-1 dry-run includes stale workflow id",
        Array.isArray(dryResp.stale_workflow_ids) &&
          (dryResp.stale_workflow_ids as string[]).includes(workflowRunId),
        "dry-run should list the seeded workflow as stale",
        `stale_workflow_ids=${JSON.stringify(dryResp.stale_workflow_ids)}`
      )
    );

    const { data: afterDry } = await supabase
      .from("workflow_runs")
      .select("status")
      .eq("id", workflowRunId)
      .single();
    assertions.push(
      assertEqual(
        "S1-2 dry-run does not mutate status",
        afterDry?.status,
        "running",
        "workflow_runs.status must remain running after dry-run"
      )
    );

    // Real pass.
    const resp = await invokeMaintenance(supabaseUrl, serviceRoleKey, {
      dry_run: false,
      stale_workflow_minutes: 10,
      max_records: 100,
      actor: "phase5-validation",
    });

    assertions.push(
      assert(
        "S1-3 real run failed at least 1 stale workflow",
        Number(resp.stale_workflow_failed ?? 0) >= 1,
        "stale_workflow_failed counter should be >= 1",
        `response=${JSON.stringify(resp)}`
      )
    );

    const { data: wr } = await supabase
      .from("workflow_runs")
      .select("status, failure_reason, completed_at")
      .eq("id", workflowRunId)
      .single();

    assertions.push(
      assertEqual("S1-4 workflow status=failed", wr?.status, "failed", "workflow should be failed")
    );
    assertions.push(
      assertEqual(
        "S1-5 failure_reason=stale_workflow_no_activity",
        wr?.failure_reason,
        "stale_workflow_no_activity",
        "failure_reason should mark stale-workflow path"
      )
    );
    assertions.push(
      assert(
        "S1-6 completed_at populated",
        Boolean(wr?.completed_at),
        "completed_at must be set when workflow terminates",
        `completed_at=${wr?.completed_at}`
      )
    );

    const { data: ar } = await supabase
      .from("activity_runs")
      .select("status, error_message, error_details")
      .eq("workflow_run_id", workflowRunId)
      .eq("activity_key", "A")
      .single();

    assertions.push(
      assertEqual("S1-7 activity status=failed", ar?.status, "failed", "activity should be failed")
    );
    assertions.push(
      assert(
        "S1-8 activity error_message mentions stalled workflow",
        typeof ar?.error_message === "string" &&
          (ar.error_message as string).includes("Workflow stalled"),
        "error_message should explain the recovery",
        `error_message=${ar?.error_message}`
      )
    );
    assertions.push(
      assertEqual(
        "S1-9 activity error_details.recovery_action=fail_stale_workflow",
        (ar?.error_details as Record<string, unknown> | null)?.recovery_action,
        "fail_stale_workflow",
        "recovery_action should tag the stale-workflow code path"
      )
    );

    const { data: events } = await supabase
      .from("workflow_events")
      .select("event_type, details")
      .eq("workflow_run_id", workflowRunId)
      .eq("event_type", "workflow_failed");

    const hasStaleEvent = (events ?? []).some(
      (e) => (e.details as Record<string, unknown> | null)?.reason === "stale_workflow_no_activity"
    );
    assertions.push(
      assert(
        "S1-10 workflow_failed event with stale reason logged",
        hasStaleEvent,
        "workflow_events should contain workflow_failed with reason=stale_workflow_no_activity",
        `events=${JSON.stringify(events)}`
      )
    );
  } catch (error) {
    assertions.push({
      name: "S1 error",
      passed: false,
      message: scenario,
      error: String(error),
    });
  } finally {
    if (workflowRunId) await cleanup(supabase, workflowRunId);
  }

  const allPassed = assertions.every((a) => a.passed);
  return { scenario, assertions, all_passed: allPassed, summary: summarize(assertions) };
}

async function validateFreshNotTouched(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceRoleKey: string,
  ids: { definitionId: string; versionId: string; activityId: string }
): Promise<ScenarioResult> {
  const scenario = "S2: fresh workflow (1 min idle) is NOT failed by maintenance";
  const assertions: AssertionResult[] = [];
  let workflowRunId: string | undefined;

  try {
    const seeded = await seedStaleRun(supabase, ids, 1);
    workflowRunId = seeded.workflowRunId;

    const resp = await invokeMaintenance(supabaseUrl, serviceRoleKey, {
      dry_run: false,
      stale_workflow_minutes: 10,
      max_records: 100,
      actor: "phase5-validation",
    });

    assertions.push(
      assert(
        "S2-1 fresh workflow not listed as stale",
        !((resp.stale_workflow_ids as string[]) ?? []).includes(workflowRunId),
        "fresh workflow should be excluded from stale_workflow_ids",
        `stale_workflow_ids=${JSON.stringify(resp.stale_workflow_ids)}`
      )
    );

    const { data: wr } = await supabase
      .from("workflow_runs")
      .select("status")
      .eq("id", workflowRunId)
      .single();
    assertions.push(
      assertEqual(
        "S2-2 fresh workflow status remains running",
        wr?.status,
        "running",
        "fresh workflow must not be flipped to failed"
      )
    );
  } catch (error) {
    assertions.push({
      name: "S2 error",
      passed: false,
      message: scenario,
      error: String(error),
    });
  } finally {
    if (workflowRunId) await cleanup(supabase, workflowRunId);
  }

  const allPassed = assertions.every((a) => a.passed);
  return { scenario, assertions, all_passed: allPassed, summary: summarize(assertions) };
}

function printResults(results: ScenarioResult[]): void {
  console.log("\n" + "=".repeat(70));
  console.log("PHASE 5 VALIDATION: STALE WORKFLOW-RUN DETECTION");
  console.log("=".repeat(70));

  for (const result of results) {
    console.log(`\n${result.scenario}`);
    console.log("-".repeat(70));
    for (const a of result.assertions) {
      const status = a.passed ? "✓ PASS" : "✗ FAIL";
      console.log(`${status}: ${a.name}`);
      if (a.error) console.log(`  Error: ${a.error}`);
    }
    console.log(`\nSummary: ${result.summary}`);
    console.log(`Status: ${result.all_passed ? "ALL PASSED ✓" : "SOME FAILED ✗"}`);
  }

  console.log("\n" + "=".repeat(70));
  const passed = results.filter((r) => r.all_passed).length;
  console.log(`OVERALL: ${passed}/${results.length} scenarios fully passed`);
  console.log("=".repeat(70) + "\n");
}

async function main() {
  const supabaseUrl =
    Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
    Deno.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log("Starting Phase 5 stale-workflow validation...\n");

  const ids = await ensureDefinition(supabase);

  const results: ScenarioResult[] = [];
  results.push(await validateStaleDetected(supabase, supabaseUrl, serviceRoleKey, ids));
  results.push(await validateFreshNotTouched(supabase, supabaseUrl, serviceRoleKey, ids));

  printResults(results);
  Deno.exit(results.every((r) => r.all_passed) ? 0 : 1);
}

if (import.meta.main) {
  main();
}
