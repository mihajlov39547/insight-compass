# Activity Handler Framework - Developer Guide

## Overview

Phase 4 introduces a formal activity handler framework for the durable workflow engine. Handlers are isolated, composable units of business logic that implement a shared interface and execution contract.

## Handler Interface

All handlers implement this TypeScript interface:

```typescript
type Handler = (input: HandlerExecutionInput) => Promise<HandlerOutput>;
```

### Input: `HandlerExecutionInput`

Required fields passed by the worker:
- `workflow_run_id`: Current workflow instance ID
- `activity_run_id`: Current activity instance ID
- `workflow_definition_id`: Workflow definition ID
- `workflow_context`: Mutable context dictionary from the workflow run
- `activity_input_payload`: Activity-specific input data
- `activity_key`: Human-readable activity key
- `handler_key`: Unique handler identifier
- `attempt_count`: Current attempt number (1-based)
- `max_attempts`: Maximum allowed attempts

### Output: `HandlerOutput`

Union of success or failure result:

```typescript
type HandlerOutput = HandlerSuccessResult | HandlerErrorResult;

interface HandlerSuccessResult {
  ok: true;
  output_payload: JsonValue;        // Immutable activity result
  context_patch?: JsonObject;       // Optional context updates (applied by orchestrator)
  metadata?: {
    duration_ms?: number;           // Execution duration
    handler_category?: string;
  };
}

interface HandlerErrorResult {
  ok: false;
  error: {
    classification: "retryable" | "terminal";
    message: string;
    code?: string;
  };
  metadata?: {
    duration_ms?: number;
  };
}
```

### Rules

1. **Handlers are isolate d from orchestration state.** Only return structured results; never directly mutate `workflow_runs` or `activity_runs`.
2. **Handlers must not throw unhandled exceptions.** All errors must be caught and normalized to `HandlerOutput` shape.
3. **Handlers receive a snapshot of context.** Context patches are applied by the orchestrator, not the handler.
4. **Handlers are logged and timed automatically.** The execution framework wraps all handlers with structured logging and timeout handling.

## Base Execution Wrapper

The `handler-framework.ts` module provides `executeHandlerSafely()`, which wraps every handler invocation with:

- **Structured logging** with workflow/activity/handler context
- **Timeout handling** using Promise.race; timeouts are retryable by default
- **Error normalization** catching thrown exceptions and converting to handler result contract

### Timeout Behavior

Timeout is specified in handler definition (or use activity_run timeout).
If timeout elapses before handler completes:
- Handler promise is abandoned
- Error is normalized to classification `retryable`
- Duration is recorded

**Limitations:** This is a promise-level timeout, not a CPU-level timeout. Handlers that spawn long-running background tasks should be aware.

## Handler Registry

The registry (`registry.ts`) is a global Map keyed by handler_key.

### Registering Handlers

Use `registerHandler()`:

```typescript
registerHandler({
  key: "my_handler_key",
  category: "compute",
  timeout_seconds: 30,
  description: "Does something useful",
  handler: myHandlerFunction,
});
```

### Dispatching Handlers

The worker calls `dispatchHandler(handlerKey, input)`, which:
1. Looks up the handler definition by key
2. Calls the handler through the execution wrapper
3. Returns normalized output
4. Unknown keys return a terminal error

## Built-In Handlers

### Debug Category (Testing & Development)

- **debug.noop** — Always succeeds; useful for sanity tests
- **debug.echo** — Echoes input payload and context keys; useful for data flow testing
- **debug.delay** — Waits for configurable delay (from `activity_input_payload.delay_ms`); useful for timing tests
- **debug.aggregate** — Returns fan-in/join-oriented output; useful for multi-predecessor testing
- **debug.fail_retryable** — Always fails with retryable classification; useful for retry path testing
- **debug.fail_terminal** — Always fails with terminal classification; useful for failure path testing

### Document Category (Placeholders for Document Processing)

These are stubs for Phase 4. Later phases will implement real document processing.

- **document.load** — Placeholder; resolves document reference from input
- **document.extract_text** — Placeholder; simulates text extraction
- **document.chunk** — Placeholder; simulates chunking into segments
- **document.summarize** — Placeholder; simulates summarization
- **document.finalize** — Placeholder; simulates pipeline finalization

All document handlers return deterministic, realistic output shapes so workflows can be tested end-to-end before production implementations are available.

## Adding a New Handler

1. **Create handler function** in appropriate module (e.g., `handlers/my_category.ts`):

```typescript
export async function myHandler(input: HandlerExecutionInput): Promise<HandlerOutput> {
  try {
    // Business logic here
    const result = await doSomething(input.activity_input_payload);
    return {
      ok: true,
      output_payload: result,
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        classification: "terminal",
        message: String(error),
        code: "MY_HANDLER_ERROR",
      },
    };
  }
}
```

2. **Register in registry** (in `registry.ts`, in `initializeBuiltInHandlers()`):

```typescript
registerHandler({
  key: "my_category.my_handler",
  category: "my_category",
  timeout_seconds: 30,
  description: "Description of what this handler does",
  handler: myHandler,
});
```

3. **Use in workflows** by referencing the handler_key in activity definitions.

4. **Test with the worker** — Call workflow-worker with activities using your handler_key.

## Execution Flow (High Level)

1. **Worker claims activity** via `claim_next_activity()`
2. **Worker loads execution context** (activity_run, workflow_run, metadata)
3. **Worker constructs HandlerExecutionInput**
4. **Worker calls `dispatchHandler(handler_key, input)`**
5. **Registry looks up handler and calls `executeHandlerSafely()`**
6. **Execution wrapper logs, enforces timeout, executes handler**
7. **Wrapper normalizes result and returns HandlerOutput**
8. **Worker applies output: persistence, downstream scheduling, finalization**

## Structured Logging

All handler execution is logged with this JSON structure:

```json
{
  "level": "info|warn|error",
  "workflow_run_id": "...",
  "activity_run_id": "...",
  "activity_key": "...",
  "handler_key": "...",
  "attempt_count": 1,
  "message": "...",
  "extra": { ... }
}
```

Logs are emitted at:
- Handler start (`info`)
- Handler success (`info` with output size)
- Handler failure (`warn` with error details)
- Handler exception (`error` with stack/details)

## Context Patches (Forward Compatibility)

Handlers may return optional `context_patch` in success results. In Phase 4, patches are captured but not applied. Later phases will implement deterministic context merge logic. This prepares the framework for stateful workflows.

## Testing Handlers

Use debug handlers to test workflow structure:

```bash
# Simple successful workflow
# entry: debug.noop -> debug.echo -> debug.noop

# Test retry behavior
# entry: debug.fail_retryable

# Test fan-in join
# entry1 -> debug.aggregate, entry2 -> debug.aggregate -> join
```

All debug handlers execute in milliseconds, making test cycles fast.

## Future Work (Out of Scope for Phase 4)

- Real document processing handlers
- Integration handlers (API calls, webhooks, etc.)
- Advanced context merge for concurrent patches
- Handler metrics and observability
- Conditional branching based on handler output
- Timeout enforcement at CPU level
