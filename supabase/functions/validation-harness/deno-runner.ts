/**
 * Phase 5 Validation Report - Deno Compatible Runner
 * 
 * This script validates fan-out/fan-in orchestration using Deno.
 * 
 * Usage:
 *   deno run --allow-net --allow-env supabase/functions/validation-harness/deno-runner.ts
 */

// @ts-nocheck
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
    error: !condition ? error : undefined,
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
    error: !passed ? `Expected ${expected}, got ${actual}` : undefined,
  };
}

async function validateScenarioA(
  supabase: ReturnType<typeof createClient>
): Promise<ScenarioResult> {
  const scenario = "Scenario A: A -> B -> (C, D, E) -> F";
  const assertions: AssertionResult[] = [];

  try {
    // Get definition and version IDs
    const { data: def } = await supabase
      .from("workflow_definitions")
      .select("id")
      .eq("key", "validation.fanout.basic")
      .single();

    const { data: ver } = await supabase
      .from("workflow_definition_versions")
      .select("id")
      .eq("workflow_definition_id", def?.id)
      .eq("is_current", true)
      .single();

    if (!def?.id || !ver?.id) {
      throw new Error("Failed to load workflow definition");
    }

    // Create workflow run
    const { data: workflowRun, error: runError } = await supabase
      .from("workflow_runs")
      .insert({
        workflow_definition_id: def.id,
        version_id: ver.id,
        status: "running",
        context: {},
        input_payload: {},
        user_id: null,
      })
      .select("id")
      .single();

    if (runError || !workflowRun) {
      throw new Error(`Failed to create workflow run: ${runError?.message}`);
    }

    const workflowRunId = workflowRun.id;

    // Get all activity runs
    const { data: activityRuns, error: activitiesError } = await supabase
      .from("activity_runs")
      .select("id, activity_id, activity_key, status")
      .eq("workflow_run_id", workflowRunId);

    if (activitiesError || !activityRuns) {
      throw new Error(`Failed to load activity runs: ${activitiesError?.message}`);
    }

    const runsByKey = new Map(activityRuns.map((ar) => [ar.activity_key, ar]));

    // A-1: Entry activity A should be queued
    const a = runsByKey.get("A");
    assertions.push(
      assertEqual(
        "A-1: Entry activity A is queued",
        a?.status,
        "queued",
        "Entry activity A should be queued on materialization"
      )
    );

    // A-2: B, C, D, E, F should be pending
    for (const key of ["B", "C", "D", "E", "F"]) {
      const run = runsByKey.get(key);
      assertions.push(
        assertEqual(
          `A-2.${key}: Activity ${key} is pending`,
          run?.status,
          "pending",
          `Activity ${key} should remain pending`
        )
      );
    }

    // Simulate A completion
    await supabase.rpc("schedule_downstream_activities", {
      p_workflow_run_id: workflowRunId,
      p_completed_activity_id: a?.activity_id,
      p_actor: "test",
    });

    // A-3: After A completes, B should be queued
    const { data: b_after } = await supabase
      .from("activity_runs")
      .select("status")
      .eq("id", runsByKey.get("B")?.id)
      .single();

    assertions.push(
      assertEqual(
        "A-3: B is queued after A completes",
        b_after?.status,
        "queued",
        "B should be queued"
      )
    );

    // Simulate B completion
    const b_id = runsByKey.get("B")?.activity_id;
    await supabase.rpc("schedule_downstream_activities", {
      p_workflow_run_id: workflowRunId,
      p_completed_activity_id: b_id,
      p_actor: "test",
    });

    // A-4: After B completes, C, D, E should be queued
    for (const key of ["C", "D", "E"]) {
      const { data: run_after } = await supabase
        .from("activity_runs")
        .select("status")
        .eq("id", runsByKey.get(key)?.id)
        .single();

      assertions.push(
        assertEqual(
          `A-4.${key}: ${key} is queued after B completes`,
          run_after?.status,
          "queued",
          `Activity ${key} should be queued`
        )
      );
    }

    // A-5: F should still be pending
    const { data: f_after_b } = await supabase
      .from("activity_runs")
      .select("status")
      .eq("id", runsByKey.get("F")?.id)
      .single();

    assertions.push(
      assertEqual(
        "A-5: F is pending after B (requires C and D)",
        f_after_b?.status,
        "pending",
        "F should remain pending"
      )
    );

    // Simulate C completion
    const c_id = runsByKey.get("C")?.activity_id;
    await supabase.rpc("schedule_downstream_activities", {
      p_workflow_run_id: workflowRunId,
      p_completed_activity_id: c_id,
      p_actor: "test",
    });

    // A-6: F should still be pending (waiting for D)
    const { data: f_after_c } = await supabase
      .from("activity_runs")
      .select("status")
      .eq("id", runsByKey.get("F")?.id)
      .single();

    assertions.push(
      assertEqual(
        "A-6: F pending after C (awaiting D)",
        f_after_c?.status,
        "pending",
        "F should remain pending until D completes"
      )
    );

    // Simulate D completion
    const d_id = runsByKey.get("D")?.activity_id;
    await supabase.rpc("schedule_downstream_activities", {
      p_workflow_run_id: workflowRunId,
      p_completed_activity_id: d_id,
      p_actor: "test",
    });

    // A-7: F should be queued after both C and D complete
    const { data: f_final } = await supabase
      .from("activity_runs")
      .select("status")
      .eq("id", runsByKey.get("F")?.id)
      .single();

    assertions.push(
      assertEqual(
        "A-7: F is queued after both C and D complete",
        f_final?.status,
        "queued",
        "F should be queued when all required predecessors complete"
      )
    );

    // A-8: E completion should not affect F
    const e_id = runsByKey.get("E")?.activity_id;
    await supabase.rpc("schedule_downstream_activities", {
      p_workflow_run_id: workflowRunId,
      p_completed_activity_id: e_id,
      p_actor: "test",
    });

    const { data: f_after_e } = await supabase
      .from("activity_runs")
      .select("status")
      .eq("id", runsByKey.get("F")?.id)
      .single();

    assertions.push(
      assertEqual(
        "A-8: F remains queued after E (no dependency on E)",
        f_after_e?.status,
        "queued",
        "F should remain queued"
      )
    );
  } catch (error) {
    assertions.push({
      name: "Error handling",
      passed: false,
      message: scenario,
      error: String(error),
    });
  }

  const allPassed = assertions.every((a) => a.passed);

  return {
    scenario,
    assertions,
    all_passed: allPassed,
    summary: `${assertions.filter((a) => a.passed).length}/${assertions.length} passed`,
  };
}

async function validateScenarioB(
  supabase: ReturnType<typeof createClient>
): Promise<ScenarioResult> {
  const scenario = "Scenario B: A -> (B, C) -> D";
  const assertions: AssertionResult[] = [];

  try {
    const { data: def } = await supabase
      .from("workflow_definitions")
      .select("id")
      .eq("key", "validation.fanin.basic")
      .single();

    const { data: ver } = await supabase
      .from("workflow_definition_versions")
      .select("id")
      .eq("workflow_definition_id", def?.id)
      .eq("is_current", true)
      .single();

    if (!def?.id || !ver?.id) {
      throw new Error("Failed to load workflow definition");
    }

    const { data: workflowRun, error: runError } = await supabase
      .from("workflow_runs")
      .insert({
        workflow_definition_id: def.id,
        version_id: ver.id,
        status: "running",
        context: {},
        input_payload: {},
        user_id: null,
      })
      .select("id")
      .single();

    if (runError || !workflowRun) {
      throw new Error(`Failed to create workflow run`);
    }

    const workflowRunId = workflowRun.id;

    const { data: activityRuns } = await supabase
      .from("activity_runs")
      .select("id, activity_id, activity_key, status")
      .eq("workflow_run_id", workflowRunId);

    const runsByKey = new Map(activityRuns!.map((ar) => [ar.activity_key, ar]));

    // B-1: A is queued
    const a = runsByKey.get("A");
    assertions.push(
      assertEqual(
        "B-1: A is queued",
        a?.status,
        "queued",
        "Entry activity A should be queued"
      )
    );

    // B-2: B, C, D are pending
    for (const key of ["B", "C", "D"]) {
      const run = runsByKey.get(key);
      assertions.push(
        assertEqual(
          `B-2.${key}: ${key} is pending`,
          run?.status,
          "pending",
          `Activity ${key} should be pending`
        )
      );
    }

    // Complete A
    await supabase.rpc("schedule_downstream_activities", {
      p_workflow_run_id: workflowRunId,
      p_completed_activity_id: a?.activity_id,
      p_actor: "test",
    });

    // B-3: B and C should be queued
    for (const key of ["B", "C"]) {
      const { data: run } = await supabase
        .from("activity_runs")
        .select("status")
        .eq("id", runsByKey.get(key)?.id)
        .single();

      assertions.push(
        assertEqual(
          `B-3.${key}: ${key} queued after A`,
          run?.status,
          "queued",
          `Activity ${key} should be queued`
        )
      );
    }

    // B-4: D should be pending
    const { data: d_initial } = await supabase
      .from("activity_runs")
      .select("status")
      .eq("id", runsByKey.get("D")?.id)
      .single();

    assertions.push(
      assertEqual(
        "B-4: D is pending after A",
        d_initial?.status,
        "pending",
        "D should remain pending"
      )
    );

    // Complete B
    const b_id = runsByKey.get("B")?.activity_id;
    await supabase.rpc("schedule_downstream_activities", {
      p_workflow_run_id: workflowRunId,
      p_completed_activity_id: b_id,
      p_actor: "test",
    });

    // B-5: D should still be pending
    const { data: d_after_b } = await supabase
      .from("activity_runs")
      .select("status")
      .eq("id", runsByKey.get("D")?.id)
      .single();

    assertions.push(
      assertEqual(
        "B-5: D pending after B (awaiting C)",
        d_after_b?.status,
        "pending",
        "D should remain pending until C completes"
      )
    );

    // Complete C
    const c_id = runsByKey.get("C")?.activity_id;
    await supabase.rpc("schedule_downstream_activities", {
      p_workflow_run_id: workflowRunId,
      p_completed_activity_id: c_id,
      p_actor: "test",
    });

    // B-6: D should be queued
    const { data: d_final } = await supabase
      .from("activity_runs")
      .select("status")
      .eq("id", runsByKey.get("D")?.id)
      .single();

    assertions.push(
      assertEqual(
        "B-6: D is queued after both B and C",
        d_final?.status,
        "queued",
        "D should be queued when all predecessors complete"
      )
    );

    // B-7: Idempotency check - repeated schedule call on C
    await supabase.rpc("schedule_downstream_activities", {
      p_workflow_run_id: workflowRunId,
      p_completed_activity_id: c_id,
      p_actor: "test",
    });

    const { data: d_repeat } = await supabase
      .from("activity_runs")
      .select("status")
      .eq("id", runsByKey.get("D")?.id)
      .single();

    assertions.push(
      assertEqual(
        "B-7: Repeated schedule call does not re-queue D",
        d_repeat?.status,
        "queued",
        "D should remain queued (idempotency)"
      )
    );
  } catch (error) {
    assertions.push({
      name: "Error handling",
      passed: false,
      message: scenario,
      error: String(error),
    });
  }

  const allPassed = assertions.every((a) => a.passed);

  return {
    scenario,
    assertions,
    all_passed: allPassed,
    summary: `${assertions.filter((a) => a.passed).length}/${assertions.length} passed`,
  };
}

async function validateScenarioC(
  supabase: ReturnType<typeof createClient>
): Promise<ScenarioResult> {
  const scenario = "Scenario C: Multiple entry activities";
  const assertions: AssertionResult[] = [];

  try {
    const { data: def } = await supabase
      .from("workflow_definitions")
      .select("id")
      .eq("key", "validation.multi_entry.basic")
      .single();

    const { data: ver } = await supabase
      .from("workflow_definition_versions")
      .select("id")
      .eq("workflow_definition_id", def?.id)
      .eq("is_current", true)
      .single();

    if (!def?.id || !ver?.id) {
      throw new Error("Failed to load workflow definition");
    }

    const { data: workflowRun, error: runError } = await supabase
      .from("workflow_runs")
      .insert({
        workflow_definition_id: def.id,
        version_id: ver.id,
        status: "running",
        context: {},
        input_payload: {},
        user_id: null,
      })
      .select("id")
      .single();

    if (runError || !workflowRun) {
      throw new Error("Failed to create workflow run");
    }

    const workflowRunId = workflowRun.id;

    const { data: activityRuns } = await supabase
      .from("activity_runs")
      .select("id, activity_id, activity_key, status")
      .eq("workflow_run_id", workflowRunId);

    const runsByKey = new Map(activityRuns!.map((ar) => [ar.activity_key, ar]));

    // C-1: All entries (A, B, C) are queued
    for (const key of ["A", "B", "C"]) {
      const run = runsByKey.get(key);
      assertions.push(
        assertEqual(
          `C-1.${key}: ${key} is queued`,
          run?.status,
          "queued",
          `Entry activity ${key} should be queued`
        )
      );
    }

    // C-2: All downstream (D, E, F) are pending
    for (const key of ["D", "E", "F"]) {
      const run = runsByKey.get(key);
      assertions.push(
        assertEqual(
          `C-2.${key}: ${key} is pending`,
          run?.status,
          "pending",
          `Activity ${key} should be pending`
        )
      );
    }

    // Complete all entries
    for (const key of ["A", "B", "C"]) {
      const actId = runsByKey.get(key)?.activity_id;
      await supabase.rpc("schedule_downstream_activities", {
        p_workflow_run_id: workflowRunId,
        p_completed_activity_id: actId,
        p_actor: "test",
      });
    }

    // C-3: All downstream should be queued independently
    for (const key of ["D", "E", "F"]) {
      const { data: run } = await supabase
        .from("activity_runs")
        .select("status")
        .eq("id", runsByKey.get(key)?.id)
        .single();

      assertions.push(
        assertEqual(
          `C-3.${key}: ${key} is queued`,
          run?.status,
          "queued",
          `Activity ${key} should be queued independently`
        )
      );
    }
  } catch (error) {
    assertions.push({
      name: "Error handling",
      passed: false,
      message: scenario,
      error: String(error),
    });
  }

  const allPassed = assertions.every((a) => a.passed);

  return {
    scenario,
    assertions,
    all_passed: allPassed,
    summary: `${assertions.filter((a) => a.passed).length}/${assertions.length} passed`,
  };
}

function printResults(results: ScenarioResult[]): void {
  console.log("\n" + "=".repeat(70));
  console.log("PHASE 5 VALIDATION: FAN-OUT AND FAN-IN ORCHESTRATION");
  console.log("=".repeat(70));

  for (const result of results) {
    console.log(`\n${result.scenario}`);
    console.log("-".repeat(70));

    for (const assertion of result.assertions) {
      const status = assertion.passed ? "✓ PASS" : "✗ FAIL";
      console.log(`${status}: ${assertion.name}`);
      if (assertion.error) {
        console.log(`  Error: ${assertion.error}`);
      }
    }

    console.log(`\nSummary: ${result.summary}`);
    console.log(
      `Status: ${result.all_passed ? "ALL PASSED ✓" : "SOME FAILED ✗"}`
    );
  }

  console.log("\n" + "=".repeat(70));

  const totalResults = results.length;
  const passedResults = results.filter((r) => r.all_passed).length;

  console.log(
    `OVERALL: ${passedResults}/${totalResults} scenarios fully passed`
  );
  console.log("=".repeat(70) + "\n");
}

async function main() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
    );
    Deno.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  console.log("Starting Phase 5 Validation...\n");

  const results: ScenarioResult[] = [];

  results.push(await validateScenarioA(supabase));
  results.push(await validateScenarioB(supabase));
  results.push(await validateScenarioC(supabase));

  printResults(results);

  const allPassed = results.every((r) => r.all_passed);
  Deno.exit(allPassed ? 0 : 1);
}

main();
