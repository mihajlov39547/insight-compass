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
  documentPrepareRun,
  documentLoadSource,
  documentExtractTextActivity,
  documentAssessQuality,
  documentDetectLanguageAndStats,
  documentGenerateSummary,
  documentBuildSearchIndex,
  documentChunkText,
  documentGenerateChunkEmbeddings,
  documentGenerateChunkQuestions,
  documentFinalizeDocument,
  documentLoad,
  documentChunk,
  documentSummarize,
  documentFinalize,
} from "./handlers/document.ts";
import {
  shadowPrepareRun,
  shadowLoadSource,
  shadowExtractText,
  shadowAssessQuality,
  shadowDetectLanguageAndStats,
  shadowGenerateSummary,
  shadowBuildSearchIndex,
  shadowChunkText,
  shadowGenerateChunkEmbeddings,
  shadowGenerateChunkQuestions,
  shadowFinalizeDocument,
} from "./handlers/shadow-document.ts";

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
/**
 * Shadow handler routing map.
 * When shadow_mode is true in workflow context, document handlers are
 * rerouted to read-only shadow variants that do NOT write production data.
 */
const SHADOW_HANDLER_MAP: Record<string, (input: HandlerExecutionInput) => Promise<HandlerOutput>> = {
  "document.prepare_run": shadowPrepareRun,
  "document.load_source": shadowLoadSource,
  "document.load": shadowLoadSource,
  "document.extract_text": shadowExtractText,
  "document.assess_quality": shadowAssessQuality,
  "document.detect_language_and_stats": shadowDetectLanguageAndStats,
  "document.generate_summary": shadowGenerateSummary,
  "document.build_search_index": shadowBuildSearchIndex,
  "document.chunk_text": shadowChunkText,
  "document.chunk": shadowChunkText,
  "document.generate_chunk_embeddings": shadowGenerateChunkEmbeddings,
  "document.generate_chunk_questions": shadowGenerateChunkQuestions,
  "document.finalize_document": shadowFinalizeDocument,
  "document.finalize": shadowFinalizeDocument,
  "document.summarize": shadowGenerateSummary,
};

export async function dispatchHandler(
  handlerKey: string,
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  // Phase E: If workflow is in shadow_mode, route document handlers to
  // read-only shadow variants that capture production state snapshots
  // without writing to production tables.
  const isShadowMode =
    typeof input.workflow_context === "object" &&
    input.workflow_context !== null &&
    (input.workflow_context as any).shadow_mode === true;

  if (isShadowMode && SHADOW_HANDLER_MAP[handlerKey]) {
    const shadowHandler = SHADOW_HANDLER_MAP[handlerKey];
    return executeHandlerSafely(shadowHandler, input, 30);
  }

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
    key: "document.prepare_run",
    category: "document",
    timeout_seconds: 10,
    description:
      "Initializes document processing run state and retry tracking",
    handler: documentPrepareRun,
  });

  registerHandler({
    key: "document.load_source",
    category: "document",
    timeout_seconds: 20,
    description: "Loads source file from storage and validates availability",
    handler: documentLoadSource,
  });

  registerHandler({
    key: "document.extract_text",
    category: "document",
    timeout_seconds: 90,
    description: "Extracts text and stores extraction diagnostics",
    handler: documentExtractTextActivity,
  });

  registerHandler({
    key: "document.assess_quality",
    category: "document",
    timeout_seconds: 20,
    description: "Applies extraction readability quality gate",
    handler: documentAssessQuality,
  });

  registerHandler({
    key: "document.detect_language_and_stats",
    category: "document",
    timeout_seconds: 30,
    description: "Detects language/script and persists word/character counts",
    handler: documentDetectLanguageAndStats,
  });

  registerHandler({
    key: "document.generate_summary",
    category: "document",
    timeout_seconds: 45,
    description: "Generates and persists document summary with soft-failure semantics",
    handler: documentGenerateSummary,
  });

  registerHandler({
    key: "document.build_search_index",
    category: "document",
    timeout_seconds: 30,
    description: "Persists normalized search text and indexing metadata",
    handler: documentBuildSearchIndex,
  });

  registerHandler({
    key: "document.chunk_text",
    category: "document",
    timeout_seconds: 30,
    description: "Creates document chunks and token metadata",
    handler: documentChunkText,
  });

  registerHandler({
    key: "document.generate_chunk_embeddings",
    category: "document",
    timeout_seconds: 60,
    description: "Generates and persists local chunk embeddings",
    handler: documentGenerateChunkEmbeddings,
  });

  registerHandler({
    key: "document.generate_chunk_questions",
    category: "document",
    timeout_seconds: 120,
    description: "Generates grounded chunk questions (optional/non-fatal enrichment)",
    handler: documentGenerateChunkQuestions,
  });

  registerHandler({
    key: "document.finalize_document",
    category: "document",
    timeout_seconds: 15,
    description: "Applies final document status for workflow-driven processing",
    handler: documentFinalizeDocument,
  });

  // Legacy aliases retained for compatibility with older definitions/tests.
  registerHandler({
    key: "document.load",
    category: "document",
    timeout_seconds: 20,
    description: "Legacy alias of document.load_source",
    handler: documentLoad,
  });

  registerHandler({
    key: "document.chunk",
    category: "document",
    timeout_seconds: 30,
    description: "Legacy alias of document.chunk_text",
    handler: documentChunk,
  });

  registerHandler({
    key: "document.summarize",
    category: "document",
    timeout_seconds: 45,
    description: "Legacy alias of document.generate_summary",
    handler: documentSummarize,
  });

  registerHandler({
    key: "document.finalize",
    category: "document",
    timeout_seconds: 15,
    description: "Legacy alias of document.finalize_document",
    handler: documentFinalize,
  });

  builtInsInitialized = true;
}
