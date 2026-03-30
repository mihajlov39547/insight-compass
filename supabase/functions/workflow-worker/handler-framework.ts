// @ts-nocheck
import type { HandlerExecutionInput } from "./contracts.ts";
import type { HandlerOutput, HandlerExecutionFrame } from "./handler-interface.ts";
import { normalizeFailureError } from "./retry-policy.ts";

/**
 * Base execution wrapper for all handlers.
 * Provides:
 * - Structured logging
 * - Timeout handling
 * - Error normalization
 * - Consistent execution frame
 */

function createLogger(frame: HandlerExecutionFrame) {
  return {
    info: (message: string, extra?: unknown) => {
      console.log(
        JSON.stringify({
          level: "info",
          workflow_run_id: frame.workflow_run_id,
          activity_run_id: frame.activity_run_id,
          activity_key: frame.activity_key,
          handler_key: frame.handler_key,
          attempt_count: frame.attempt_count,
          message,
          ...(extra && { extra }),
        })
      );
    },
    warn: (message: string, extra?: unknown) => {
      console.warn(
        JSON.stringify({
          level: "warn",
          workflow_run_id: frame.workflow_run_id,
          activity_run_id: frame.activity_run_id,
          activity_key: frame.activity_key,
          handler_key: frame.handler_key,
          attempt_count: frame.attempt_count,
          message,
          ...(extra && { extra }),
        })
      );
    },
    error: (message: string, extra?: unknown) => {
      console.error(
        JSON.stringify({
          level: "error",
          workflow_run_id: frame.workflow_run_id,
          activity_run_id: frame.activity_run_id,
          activity_key: frame.activity_key,
          handler_key: frame.handler_key,
          attempt_count: frame.attempt_count,
          message,
          ...(extra && { extra }),
        })
      );
    },
  };
}

function createTimeoutPromise(timeout_ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(
        new Error(`Handler execution timed out after ${timeout_ms}ms`)
      );
    }, timeout_ms);
  });
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    const isTimeout = error.message.includes("timed out");
    return normalizeFailureError({
      category: isTimeout ? "external_timeout" : undefined,
      message: error.message,
      code: isTimeout ? "HANDLER_TIMEOUT" : "HANDLER_ERROR",
      classification: isTimeout ? "retryable" : "terminal",
    });
  }
  return normalizeFailureError({
    message: String(error),
    code: "HANDLER_ERROR",
    classification: "terminal",
  });
}

/**
 * Execute a handler with execution wrapper: logging, timeout, error handling.
 */
export async function executeHandlerSafely(
  handler: (input: HandlerExecutionInput) => Promise<HandlerOutput>,
  input: HandlerExecutionInput,
  timeout_seconds?: number
): Promise<HandlerOutput> {
  const frame: HandlerExecutionFrame = {
    workflow_run_id: input.workflow_run_id,
    activity_run_id: input.activity_run_id,
    activity_key: input.activity_key,
    handler_key: input.handler_key,
    attempt_count: input.attempt_count,
    timestamp_start_iso: new Date().toISOString(),
  };

  const logger = createLogger(frame);

  logger.info("Handler execution started", { timeout_seconds });

  const startTime = Date.now();

  try {
    let result: HandlerOutput;

    if (timeout_seconds && timeout_seconds > 0) {
      const timeout_ms = timeout_seconds * 1000;
      result = await Promise.race([
        handler(input),
        createTimeoutPromise(timeout_ms),
      ]);
    } else {
      result = await handler(input);
    }

    const duration_ms = Date.now() - startTime;
    if (result.metadata) {
      result.metadata.duration_ms = duration_ms;
    } else {
      result.metadata = { duration_ms };
    }

    if (result.ok) {
      logger.info("Handler execution succeeded", {
        duration_ms,
        output_size: JSON.stringify(result.output_payload).length,
      });
    } else {
      const normalizedFailure = normalizeFailureError(result.error);
      result = {
        ...result,
        error: normalizedFailure,
      };

      logger.warn("Handler execution failed", {
        duration_ms,
        error_code: normalizedFailure.code,
        classification: normalizedFailure.classification,
        taxonomy_category: normalizedFailure.category,
      });
    }

    return result;
  } catch (error) {
    const duration_ms = Date.now() - startTime;
    const normalized = normalizeError(error);

    logger.error("Handler execution error", {
      duration_ms,
      error_message: normalized.message,
      error_code: normalized.code,
      classification: normalized.classification,
    });

    return {
      ok: false,
      error: {
        classification: normalized.classification,
        category: normalized.category,
        message: normalized.message,
        code: normalized.code,
      },
      metadata: { duration_ms },
    };
  }
}
