/**
 * Phase 5 Validation Harness
 * Tests fan-out and fan-in orchestration behavior.
 * Validates state transitions, idempotency, and branch independence.
 *
 * Usage:
 *   deno run --allow-net --allow-env supabase/functions/validation-harness/runner.ts
 *
 * Or as a Node.js test:
 *   npx ts-node supabase/functions/validation-harness/runner.ts
 */

// @ts-nocheck
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

/**
 * Result of a single assertion
 */
interface AssertionResult {
  name: string;
  passed: boolean;
  message: string;
  error?: string;
}

/**
 * Result of scenario validation
 */
interface ScenarioResult {
  scenario: string;
  assertions: AssertionResult[];
  all_passed: boolean;
  summary: string;
}

/**
 * Assert a condition
 */
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

/**
 * Assert equality
 */
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

/**
 * Validate Scenario A: A -> B -> (C, D, E) -> F
 * F depends on C and D; E is parallel but not required for F
 */
async function validateScenarioA(
  supabase: SupabaseClient
): Promise<ScenarioResult> {
  const scenario = "Scenario A: A -> B -> (C, D, E) -> F";
  const assertions: AssertionResult[] = [];

  try {
    // Create workflow run
    const { data: workflowRun, error: runError } = await supabase
      .from("workflow_runs")
      .insert({
        workflow_definition_id: (
          await supabase
            .from("workflow_definitions")
            .select("id")
            .eq("key", "validation.fanout.basic")
            .single()
        ).data?.id,
        version_id: (
          await supabase
            .from("workflow_definition_versions")
            .select("id")
            .eq("workflow_definition_id", (
              await supabase
                .from("workflow_definitions")
                .select("id")
                .eq("key", "validation.fanout.basic")
                .single()
            ).data?.id)
            .eq("is_current", true)
            .single()
        ).data?.id,
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

    // A-2: B, C, D, E, F should be pending on materialization
    for (const key of ["B", "C", "D", "E", "F"]) {
      const run = runsByKey.get(key);
      assertions.push(
        assertEqual(
          `A-2.${key}: Activity ${key} is pending`,
          run?.status,
          "pending",
          `Activity ${key} should remain pending until predecessors complete`
        )
      );
    }

    // Simulate A completion
    const { error: aCompleteError } = await supabase.rpc(
      "schedule_downstream_activities",
      {
        p_workflow_run_id: workflowRunId,
        p_completed_activity_id: a?.activity_id,
        p_actor: "test",
      }
    );

    if (aCompleteError) {
      throw new Error(`Failed to schedule after A: ${aCompleteError.message}`);
    }

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
        "B should be queued after A completes"
      )
    );

    // Simulate B completion
    const b_id = runsByKey.get("B")?.activity_id;
    const { error: bCompleteError } = await supabase.rpc(
      "schedule_downstream_activities",
      {
        p_workflow_run_id: workflowRunId,
        p_completed_activity_id: b_id,
        p_actor: "test",
      }
    );

    if (bCompleteError) {
      throw new Error(`Failed to schedule after B: ${bCompleteError.message}`);
    }

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
          `Activity ${key} should be queued after B completes`
        )
      );
    }

    // A-5: F should still be pending (requires both C and D)
    const { data: f_after_b } = await supabase
      .from("activity_runs")
      .select("status")
      .eq("id", runsByKey.get("F")?.id)
      .single();

    assertions.push(
      assert(
        "A-5: F is pending after B completes",
        f_after_b?.status === "pending",
        "F should remain pending (requires C and D, not E)",
        `Expected pending, got ${f_after_b?.status}`
      )
    );

    // Simulate C completion
    const c_id = runsByKey.get("C")?.activity_id;
    const { error: cCompleteError } = await supabase.rpc(
      "schedule_downstream_activities",
      {
        p_workflow_run_id: workflowRunId,
        p_completed_activity_id: c_id,
        p_actor: "test",
      }
    );

    if (cCompleteError) {
      throw new Error(`Failed to schedule after C: ${cCompleteError.message}`);
    }

    // A-6: F should still be pending (requires both C and D, C done, D pending)
    const { data: f_after_c } = await supabase
      .from("activity_runs")
      .select("status")
      .eq("id", runsByKey.get("F")?.id)
      .single();

    assertions.push(
      assert(
        "A-6: F is still pending after C (awaiting D)",
        f_after_c?.status === "pending",
        "F should remain pending until both C and D complete",
        `Expected pending, got ${f_after_c?.status}`
      )
    );

    // Simulate D completion
    const d_id = runsByKey.get("D")?.activity_id;
    const { error: dCompleteError } = await supabase.rpc(
      "schedule_downstream_activities",
      {
        p_workflow_run_id: workflowRunId,
        p_completed_activity_id: d_id,
        p_actor: "test",
      }
    );

    if (dCompleteError) {
      throw new Error(`Failed to schedule after D: ${dCompleteError.message}`);
    }

    // A-7: F should be queued after both C and D complete (E completion not required)
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
        "F should be queued when all required predecessors (C, D) are done"
      )
    );

    // A-8: E completion should not affect F further (idempotency test)
    const e_id = runsByKey.get("E")?.activity_id;
    const { error: eCompleteError } = await supabase.rpc(
      "schedule_downstream_activities",
      {
        p_workflow_run_id: workflowRunId,
        p_completed_activity_id: e_id,
        p_actor: "test",
      }
    );

    if (eCompleteError) {
      // E has no downstream, so this may return an error or empty result
      // That's acceptable
    }

    const { data: f_after_e } = await supabase
      .from("activity_runs")
      .select("status")
      .eq("id", runsByKey.get("F")?.id)
      .single();

    assertions.push(
      assertEqual(
        "A-8: F remains queued after E (no effect)",
        f_after_e?.status,
        "queued",
        "F should remain queued; E is not a predecessor"
      )
    );
  } catch (error) {
    assertions.push(
      assert(
        "Error handling",
        false,
        scenario,
        String(error)
      )
    );
  }

  const allPassed = assertions.every((a) => a.passed);

  return {
    scenario,
    assertions,
    all_passed: allPassed,
    summary: `${assertions.filter((a) => a.passed).length}/${assertions.length} passed`,
  };
}

/**
 * Validate Scenario B: A -> (B, C) -> D
 * Simple fan-out to fan-in
 */
async function validateScenarioB(
  supabase: SupabaseClient
): Promise<ScenarioResult> {
  const scenario = "Scenario B: A -> (B, C) -> D";
  const assertions: AssertionResult[] = [];

  try {
    // Create workflow run
    const defData = await supabase
      .from("workflow_definitions")
      .select("id")
      .eq("key", "validation.fanin.basic")
      .single();

    const verData = await supabase
      .from("workflow_definition_versions")
      .select("id")
      .eq("workflow_definition_id", defData.data?.id)
      .eq("is_current", true)
      .single();

    const { data: workflowRun, error: runError } = await supabase
      .from("workflow_runs")
      .insert({
        workflow_definition_id: defData.data?.id,
        version_id: verData.data?.id,
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

    const { data: activityRuns } = await supabase
      .from("activity_runs")
      .select("id, activity_id, activity_key, status")
      .eq("workflow_run_id", workflowRunId);

    const runsByKey = new Map(activityRuns!.map((ar) => [ar.activity_key, ar]));

    // B-1: A is queued on entry
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
          `Activity ${key} should be pending initially`
        )
      );
    }

    // Complete A
    const { error: aError } = await supabase.rpc(
      "schedule_downstream_activities",
      {
        p_workflow_run_id: workflowRunId,
        p_completed_activity_id: a?.activity_id,
        p_actor: "test",
      }
    );

    if (aError) {
      throw new Error(`Failed to schedule after A: ${aError.message}`);
    }

    // B-3: After A completes, both B and C should be queued
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
          `Activity ${key} should be queued after A completes`
        )
      );
    }

    // B-4: D should still be pending (requires both B and C)
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
        "D should remain pending until both B and C complete"
      )
    );

    // Complete B
    const b_id = runsByKey.get("B")?.activity_id;
    const { error: bError } = await supabase.rpc(
      "schedule_downstream_activities",
      {
        p_workflow_run_id: workflowRunId,
        p_completed_activity_id: b_id,
        p_actor: "test",
      }
    );

    if (bError) {
      throw new Error(`Failed to schedule after B: ${bError.message}`);
    }

    // B-5: D should still be pending (B done, C pending)
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
        "D should remain pending until C also completes"
      )
    );

    // Complete C
    const c_id = runsByKey.get("C")?.activity_id;
    const { error: cError } = await supabase.rpc(
      "schedule_downstream_activities",
      {
        p_workflow_run_id: workflowRunId,
        p_completed_activity_id: c_id,
        p_actor: "test",
      }
    );

    if (cError) {
      throw new Error(`Failed to schedule after C: ${cError.message}`);
    }

    // B-6: D should be queued after both B and C complete
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
        "D should be queued when all predecessors (B, C) are complete"
      )
    );

    // B-7: Repeated schedule_downstream_activities on C should not duplicate D's queue
    const { error: cRepeatError } = await supabase.rpc(
      "schedule_downstream_activities",
      {
        p_workflow_run_id: workflowRunId,
        p_completed_activity_id: c_id,
        p_actor: "test",
      }
    );

    // Repeated call may fail or succeed, but should not change D's status
    const { data: d_final_repeat } = await supabase
      .from("activity_runs")
      .select("status")
      .eq("id", runsByKey.get("D")?.id)
      .single();

    assertions.push(
      assertEqual(
        "B-7: Repeated schedule call does not re-queue D",
        d_final_repeat?.status,
        "queued",
        "D should remain queued, not duplicated"
      )
    );
  } catch (error) {
    assertions.push(
      assert(
        "Error handling",
        false,
        scenario,
        String(error)
      )
    );
  }

  const allPassed = assertions.every((a) => a.passed);

  return {
    scenario,
    assertions,
    all_passed: allPassed,
    summary: `${assertions.filter((a) => a.passed).length}/${assertions.length} passed`,
  };
}

/**
 * Validate Scenario C: Multiple entry activities
 * A (entry) -> D, B (entry) -> E, C (entry) -> F
 * Independent branches
 */
async function validateScenarioC(
  supabase: SupabaseClient
): Promise<ScenarioResult> {
  const scenario = "Scenario C: Multiple entry activities";
  const assertions: AssertionResult[] = [];

  try {
    const defData = await supabase
      .from("workflow_definitions")
      .select("id")
      .eq("key", "validation.multi_entry.basic")
      .single();

    const verData = await supabase
      .from("workflow_definition_versions")
      .select("id")
      .eq("workflow_definition_id", defData.data?.id)
      .eq("is_current", true)
      .single();

    const { data: workflowRun, error: runError } = await supabase
      .from("workflow_runs")
      .insert({
        workflow_definition_id: defData.data?.id,
        version_id: verData.data?.id,
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

    const { data: activityRuns } = await supabase
      .from("activity_runs")
      .select("id, activity_id, activity_key, status")
      .eq("workflow_run_id", workflowRunId);

    const runsByKey = new Map(activityRuns!.map((ar) => [ar.activity_key, ar]));

    // C-1: All entry activities (A, B, C) are queued
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

    // C-2: All downstream activities (D, E, F) are pending
    for (const key of ["D", "E", "F"]) {
      const run = runsByKey.get(key);
      assertions.push(
        assertEqual(
          `C-2.${key}: ${key} is pending`,
          run?.status,
          "pending",
          `Activity ${key} should be pending initially`
        )
      );
    }

    // Complete A; should queue D but not affect others
    const a_id = runsByKey.get("A")?.activity_id;
    const { error: aError } = await supabase.rpc(
      "schedule_downstream_activities",
      {
        p_workflow_run_id: workflowRunId,
        p_completed_activity_id: a_id,
        p_actor: "test",
      }
    );

    if (aError) {
      throw new Error(`Failed to schedule after A: ${aError.message}`);
    }

    // C-3: D should be queued, E and F remain pending
    const { data: d_after_a } = await supabase
      .from("activity_runs")
      .select("status")
      .eq("id", runsByKey.get("D")?.id)
      .single();

    assertions.push(
      assertEqual(
        "C-3: D is queued after A",
        d_after_a?.status,
        "queued",
        "D should be queued when A completes"
      )
    );

    for (const key of ["E", "F"]) {
      const { data: run } = await supabase
        .from("activity_runs")
        .select("status")
        .eq("id", runsByKey.get(key)?.id)
        .single();

      assertions.push(
        assertEqual(
          `C-3.${key}: ${key} remains pending`,
          run?.status,
          "pending",
          `Activity ${key} should not be affected by A`
        )
      );
    }

    // Complete B and C similarly
    for (const [key, downKey] of [["B", "E"], ["C", "F"]]) {
      const { data: run } = await supabase
        .from("activity_runs")
        .select("activity_id")
        .eq("id", runsByKey.get(key)?.id)
        .single();

      const { error: schedError } = await supabase.rpc(
        "schedule_downstream_activities",
        {
          p_workflow_run_id: workflowRunId,
          p_completed_activity_id: run?.activity_id,
          p_actor: "test",
        }
      );

      if (schedError) {
        throw new Error(
          `Failed to schedule after ${key}: ${schedError.message}`
        );
      }

      const { data: downRun } = await supabase
        .from("activity_runs")
        .select("status")
        .eq("id", runsByKey.get(downKey)?.id)
        .single();

      assertions.push(
        assertEqual(
          `C-4.${downKey}: ${downKey} queued after ${key}`,
          downRun?.status,
          "queued",
          `Activity ${downKey} should be queued when ${key} completes`
        )
      );
    }

    // C-5: Branch independence - verify all three downstream are queued independently
    const statusMap = new Map<string, string>();
    for (const key of ["D", "E", "F"]) {
      const { data: run } = await supabase
        .from("activity_runs")
        .select("status")
        .eq("id", runsByKey.get(key)?.id)
        .single();
      statusMap.set(key, run?.status);
    }

    assertions.push(
      assert(
        "C-5: All downstream queued independently",
        statusMap.get("D") === "queued" &&
          statusMap.get("E") === "queued" &&
          statusMap.get("F") === "queued",
        "Independent branches should all be queued",
        `D=${statusMap.get("D")}, E=${statusMap.get("E")}, F=${statusMap.get("F")}`
      )
    );
  } catch (error) {
    assertions.push(
      assert(
        "Error handling",
        false,
        scenario,
        String(error)
      )
    );
  }

  const allPassed = assertions.every((a) => a.passed);

  return {
    scenario,
    assertions,
    all_passed: allPassed,
    summary: `${assertions.filter((a) => a.passed).length}/${assertions.length} passed`,
  };
}

/**
 * Print scenario results
 */
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
      console.log(`  Message: ${assertion.message}`);
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

/**
 * Main validation runner
 */
async function runValidation(supabase: SupabaseClient): Promise<void> {
  console.log("Starting Phase 5 Validation...\n");

  const results: ScenarioResult[] = [];

  // Run all scenarios
  results.push(await validateScenarioA(supabase));
  results.push(await validateScenarioB(supabase));
  results.push(await validateScenarioC(supabase));

  // Print results
  printResults(results);

  // Exit with status
  const allPassed = results.every((r) => r.all_passed);
  process.exit(allPassed ? 0 : 1);
}

// Export for use as module or run directly
if (typeof require !== "undefined" && require.main === module) {
  const { createClient } = require("@supabase/supabase-js");
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  runValidation(supabase);
}

export { runValidation, validateScenarioA, validateScenarioB, validateScenarioC };
