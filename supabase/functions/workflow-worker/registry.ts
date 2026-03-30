import type {
  HandlerDefinition,
  HandlerOutput,
} from "./handler-interface.ts";
import type { HandlerExecutionInput } from "./contracts.ts";
import { executeHandlerSafely } from "./handler-framework.ts";
import {
  debugNoop,
  debugEcho,
  debugDelay,
  debugAggregate,
  debugFailRetryable,
  debugFailTerminal,
  debugFailNTimesThenSucceed,
} from "./handlers/debug.ts";
import {
  documentLoad,
  documentExtractText,
  documentChunk,
  documentSummarize,
  documentFinalize,
} from "./handlers/document.ts";

/**
 * Global handler registry, keyed by handler_key.
 * Handlers are registered by category; each handler is a definition with metadata.
 */

const registry: Map<string, HandlerDefinition> = new Map();
let builtInsInitialized = false;

/**
 * Register a handler in the registry.
 */
export function registerHandler(definition: HandlerDefinition): void {
  registry.set(definition.key, definition);
}

/**
 * Retrieve a handler definition by key.
 */
export function getHandlerDefinition(key: string): HandlerDefinition | undefined {
  return registry.get(key);
}

/**
 * Dispatch handler execution by key, using the base execution wrapper.
 * Unknown keys produce a normalized terminal error.
 */
export async function dispatchHandler(
  handlerKey: string,
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  const definition = registry.get(handlerKey);

  if (!definition) {
    return {
      ok: false,
      error: {
        classification: "terminal",
        message: `Handler not found: ${handlerKey}`,
        code: "HANDLER_NOT_FOUND",
      },
    };
  }

  return executeHandlerSafely(
    definition.handler,
    input,
    definition.timeout_seconds
  );
}

/**
 * List all registered handlers (useful for debugging).
 */
export function listHandlers(): Array<{
  key: string;
  category: string;
  description: string;
}> {
  return Array.from(registry.values()).map((def) => ({
    key: def.key,
    category: def.category,
    description: def.description,
  }));
}

/**
 * Register all built-in handlers.
 */
export function initializeBuiltInHandlers(): void {
  if (builtInsInitialized) {
    return;
  }

  registerHandler({
    key: "debug.noop",
    category: "debug",
    timeout_seconds: 5,
    description: "No-op debug handler; always succeeds",
    handler: debugNoop,
  });

  registerHandler({
    key: "debug.echo",
    category: "debug",
    timeout_seconds: 5,
    description: "Echo debug handler; returns input payload and context keys",
    handler: debugEcho,
  });

  registerHandler({
    key: "debug.delay",
    category: "debug",
    timeout_seconds: 30,
    description:
      "Delay debug handler; waits for configurable duration from activity input",
    handler: debugDelay,
  });

  registerHandler({
    key: "debug.aggregate",
    category: "debug",
    timeout_seconds: 10,
    description:
      "Aggregate debug handler; returns fan-in/join-oriented output shape",
    handler: debugAggregate,
  });

  registerHandler({
    key: "debug.fail_retryable",
    category: "debug",
    timeout_seconds: 5,
    description: "Retryable failure debug handler; for testing retry behavior",
    handler: debugFailRetryable,
  });

  registerHandler({
    key: "debug.fail_terminal",
    category: "debug",
    timeout_seconds: 5,
    description: "Terminal failure debug handler; for testing failure paths",
    handler: debugFailTerminal,
  });

  registerHandler({
    key: "debug.fail_n_times_then_succeed",
    category: "debug",
    timeout_seconds: 5,
    description:
      "Retry test handler; fails retryably for N attempts then succeeds",
    handler: debugFailNTimesThenSucceed,
  });

  registerHandler({
    key: "document.load",
    category: "document",
    timeout_seconds: 10,
    description: "Document load placeholder; resolves document reference",
    handler: documentLoad,
  });

  registerHandler({
    key: "document.extract_text",
    category: "document",
    timeout_seconds: 30,
    description: "Document text extraction placeholder",
    handler: documentExtractText,
  });

  registerHandler({
    key: "document.chunk",
    category: "document",
    timeout_seconds: 20,
    description: "Document chunking placeholder",
    handler: documentChunk,
  });

  registerHandler({
    key: "document.summarize",
    category: "document",
    timeout_seconds: 30,
    description: "Document summarization placeholder",
    handler: documentSummarize,
  });

  registerHandler({
    key: "document.finalize",
    category: "document",
    timeout_seconds: 15,
    description: "Document pipeline finalization placeholder",
    handler: documentFinalize,
  });

  builtInsInitialized = true;
}
