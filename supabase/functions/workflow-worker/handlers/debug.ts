import type { HandlerExecutionInput } from "../contracts.ts";
import type { HandlerOutput } from "../handler-interface.ts";

/**
 * Debug handlers for testing and development.
 * Each handler implements the Handler interface and uses the execution framework.
 */

export async function debugNoop(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return {
    ok: true,
    output_payload: {
      handler: "debug.noop",
      executed_at: new Date().toISOString(),
      message: "No operation completed successfully",
    },
  };
}

export async function debugEcho(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return {
    ok: true,
    output_payload: {
      handler: "debug.echo",
      executed_at: new Date().toISOString(),
      echoed_input: input.activity_input_payload,
      echoed_context_keys: Object.keys(input.workflow_context),
      echoed_metadata: {
        activity_key: input.activity_key,
        handler_key: input.handler_key,
        attempt_count: input.attempt_count,
      },
    },
  };
}

export async function debugDelay(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  // Extract delay_ms from activity input, default 100ms, max 10000ms
  let delayMs = 100;
  if (
    typeof input.activity_input_payload === "object" &&
    input.activity_input_payload !== null &&
    !Array.isArray(input.activity_input_payload) &&
    "delay_ms" in input.activity_input_payload
  ) {
    const rawDelay = (
      input.activity_input_payload as Record<string, unknown>
    ).delay_ms;
    const numDelay = typeof rawDelay === "number" ? rawDelay : 100;
    delayMs = Math.min(Math.max(numDelay, 0), 10000);
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));

  return {
    ok: true,
    output_payload: {
      handler: "debug.delay",
      executed_at: new Date().toISOString(),
      delay_ms: delayMs,
      message: `Delayed for ${delayMs}ms`,
    },
  };
}

export async function debugAggregate(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  // Return a fan-in aggregation-oriented output with context summary
  const contextSummary = {
    keys: Object.keys(input.workflow_context),
    key_count: Object.keys(input.workflow_context).length,
  };

  return {
    ok: true,
    output_payload: {
      handler: "debug.aggregate",
      executed_at: new Date().toISOString(),
      activity_summary: {
        activity_key: input.activity_key,
        handler_key: input.handler_key,
        attempt_count: input.attempt_count,
      },
      context_summary: contextSummary,
      aggregation_ready: true,
      message: "Ready for fan-in join",
    },
  };
}

export async function debugFailRetryable(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return {
    ok: false,
    error: {
      classification: "retryable",
      category: "transient",
      message: "Debug retryable failure for testing retry behavior",
      code: "DEBUG_RETRYABLE",
    },
  };
}

export async function debugFailTerminal(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return {
    ok: false,
    error: {
      classification: "terminal",
      category: "permanent",
      message: "Debug terminal failure for testing failure paths",
      code: "DEBUG_TERMINAL",
    },
  };
}

export async function debugFailNTimesThenSucceed(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  let failTimes = 2;

  if (
    typeof input.activity_input_payload === "object" &&
    input.activity_input_payload !== null &&
    !Array.isArray(input.activity_input_payload) &&
    "fail_times" in input.activity_input_payload
  ) {
    const raw = (input.activity_input_payload as Record<string, unknown>).fail_times;
    if (typeof raw === "number") {
      failTimes = Math.min(Math.max(Math.floor(raw), 0), 10);
    }
  } else if (
    typeof input.workflow_context === "object" &&
    input.workflow_context !== null &&
    !Array.isArray(input.workflow_context) &&
    "fail_times" in input.workflow_context
  ) {
    const raw = (input.workflow_context as Record<string, unknown>).fail_times;
    if (typeof raw === "number") {
      failTimes = Math.min(Math.max(Math.floor(raw), 0), 10);
    }
  }

  if (input.attempt_count <= failTimes) {
    return {
      ok: false,
      error: {
        classification: "retryable",
        category: "transient",
        message: `Planned retryable failure ${input.attempt_count}/${failTimes}`,
        code: "DEBUG_FAIL_N_TIMES",
        details: {
          fail_times: failTimes,
          current_attempt: input.attempt_count,
        },
      },
    };
  }

  return {
    ok: true,
    output_payload: {
      handler: "debug.fail_n_times_then_succeed",
      executed_at: new Date().toISOString(),
      fail_times: failTimes,
      recovered_on_attempt: input.attempt_count,
      message: "Recovered after planned retry failures",
    },
  };
}
