import type { HandlerResult, HandlerExecutionInput } from "./contracts.ts";

export const debugHandlers: Record<
  string,
  (input: HandlerExecutionInput) => Promise<HandlerResult>
> = {
  async ["debug.noop"](input: HandlerExecutionInput): Promise<HandlerResult> {
    return {
      ok: true,
      output_payload: {
        handler: "debug.noop",
        executed_at: new Date().toISOString(),
        message: "No operation completed successfully",
      },
    };
  },

  async ["debug.echo"](input: HandlerExecutionInput): Promise<HandlerResult> {
    return {
      ok: true,
      output_payload: {
        handler: "debug.echo",
        executed_at: new Date().toISOString(),
        echoed_input: input.activity_input_payload,
        echoed_context_keys: Object.keys(input.workflow_context),
      },
    };
  },

  async "debug.fail_retryable"(
    input: HandlerExecutionInput
  ): Promise<HandlerResult> {
    return {
      ok: false,
      error: {
        classification: "retryable",
        message: "Debug retryable failure for testing",
        code: "DEBUG_RETRYABLE",
      },
    };
  },

  async "debug.fail_terminal"(
    input: HandlerExecutionInput
  ): Promise<HandlerResult> {
    return {
      ok: false,
      error: {
        classification: "terminal",
        message: "Debug terminal failure for testing",
        code: "DEBUG_TERMINAL",
      },
    };
  },
};

export async function executeHandler(
  handlerKey: string,
  input: HandlerExecutionInput
): Promise<HandlerResult> {
  const handler = debugHandlers[handlerKey as keyof typeof debugHandlers];

  if (!handler) {
    return {
      ok: false,
      error: {
        classification: "terminal",
        message: `Handler not found: ${handlerKey}`,
        code: "HANDLER_NOT_FOUND",
      },
    };
  }

  try {
    return await handler(input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown handler error";
    return {
      ok: false,
      error: {
        classification: "terminal",
        message: `Handler execution error: ${message}`,
        code: "HANDLER_EXECUTION_ERROR",
      },
    };
  }
}
