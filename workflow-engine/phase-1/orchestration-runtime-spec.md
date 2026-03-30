# Durable Workflow Engine - Phase 1 Runtime Spec

Status: locked for Phase 1
Scope: contracts, orchestration rules, and conventions only
Out of scope: worker execution implementation, queue processors, schema changes, RLS changes, helper SQL changes

## 1) Purpose

Define deterministic runtime behavior for the durable workflow engine built on Supabase/Postgres so later phases implement one consistent state machine.

## 2) Source of Truth Rules

1. `workflow_runs` is the source of truth for workflow instance state.
2. `activity_runs` is the source of truth for activity execution state.
3. `workflow_activities` and `workflow_edges` define the DAG for a versioned workflow definition.
4. `activity_runs.output_payload` is immutable once activity status is terminal (`completed`, `failed`, `cancelled`, `skipped`).
5. `workflow_runs.context` is mutable only by orchestrator-controlled merge logic.
6. `schedule_downstream_activities(workflow_run_id, completed_activity_id)` is the only mechanism that promotes downstream nodes from `pending` to `queued`.
7. `claim_next_activity(worker_id, ...)` is the only mechanism that assigns claimable work to a worker.
8. Retry behavior never recreates a workflow run. Retries operate on the same `activity_runs` row and increment attempts.
9. A new user request always creates a new `workflow_runs` row.

## 3) Orchestration Principles

1. Orchestration is state-machine driven, not in-memory driven.
2. Every transition must be valid per transition tables in this document.
3. Terminal statuses are write-once from a semantics perspective (no reopening terminal nodes/runs).
4. Downstream scheduling occurs only after a predecessor reaches terminal success semantics (`completed`, and in future maybe `skipped` if enabled).
5. Claiming and lease semantics must be concurrency-safe (`FOR UPDATE SKIP LOCKED`).

## 4) DAG Semantics (MVP)

1. Join policy supported in MVP: `all` only.
2. `is_activity_runnable(...)` evaluates whether all predecessor activity runs are in `completed` or `skipped`.
3. `schedule_downstream_activities(...)` queues downstream activity runs only when runnable.
4. Conditional branching (`condition_expr`) is deferred as execution behavior for later phases.

## 5) Workflow Context and Activity Output Rules

1. Handlers receive a snapshot of current workflow context and activity input.
2. Handlers return `output_payload` and optional `context_patch`.
3. Handlers must not write directly to `workflow_runs.context`.
4. Orchestrator applies context patches deterministically and writes merged context to `workflow_runs.context`.
5. If multiple patches are merged, merge order must be deterministic (deferred implementation detail; contract locked).

## 6) Retry and Failure Semantics

1. Retryable failures move activity to `waiting_retry` with `next_retry_at`.
2. Scheduler/orchestrator later promotes `waiting_retry` to `queued` when retry time has arrived.
3. Terminal failures move activity to `failed`.
4. Workflow run moves to `failed` when failure policy determines workflow cannot continue.
5. Timeout and cancellation are workflow-level controls and produce terminal statuses.

## 7) Lifecycle Tables

## 7.1 Workflow Run Status Transitions

| From | To | Trigger/Event | Allowed Actor | Terminal After Transition |
| --- | --- | --- | --- | --- |
| `pending` | `running` | Orchestrator starts run and schedules/claims first executable activities | Orchestrator | No |
| `pending` | `cancelled` | Cancel requested before execution starts | Orchestrator/API control plane | Yes |
| `pending` | `timed_out` | Run timeout reached before start completion path | Orchestrator/timeout monitor | Yes |
| `running` | `completed` | All required activities reached terminal success path and workflow finalization succeeded | Orchestrator | Yes |
| `running` | `failed` | Terminal failure policy reached (non-retryable path) | Orchestrator | Yes |
| `running` | `cancelled` | Explicit cancellation request during execution | Orchestrator/API control plane | Yes |
| `running` | `timed_out` | Timeout monitor determines run exceeded timeout | Orchestrator/timeout monitor | Yes |

Notes:
- No transitions are allowed out of terminal workflow statuses (`completed`, `failed`, `cancelled`, `timed_out`).
- `workflow_runs.status` changes are orchestrator-owned.

## 7.2 Activity Run Status Transitions

| From | To | Trigger/Event | Allowed Actor | Terminal After Transition | Notes |
| --- | --- | --- | --- | --- | --- |
| `pending` | `queued` | Entry scheduling or downstream scheduling after dependency satisfaction | Orchestrator via scheduling rules (`schedule_downstream_activities` for downstream) | No | Initial entry scheduling is orchestrator-controlled |
| `pending` | `cancelled` | Workflow cancelled before activity execution | Orchestrator | Yes | Bulk cancellation path |
| `queued` | `claimed` | Worker claim operation | Orchestrator/claim helper path (`claim_next_activity`) | No | Lease starts |
| `queued` | `cancelled` | Workflow cancelled while queued | Orchestrator | Yes | |
| `claimed` | `running` | Worker starts execution and reports start | Orchestrator/worker runtime adapter | No | Start heartbeat/event path |
| `claimed` | `queued` | Lease expires before start/finish and activity is requeued | Orchestrator/lease monitor | No | Attempt already consumed at claim time |
| `claimed` | `cancelled` | Workflow cancelled while claimed | Orchestrator | Yes | |
| `running` | `completed` | Handler returns success contract | Orchestrator applying handler result | Yes | Writes immutable `output_payload` |
| `running` | `waiting_retry` | Handler returns retryable failure contract | Orchestrator applying handler result | No | Sets retry schedule (`next_retry_at`) |
| `running` | `failed` | Handler returns terminal failure contract or retries exhausted | Orchestrator applying policy | Yes | |
| `running` | `cancelled` | Workflow cancellation applied while running | Orchestrator | Yes | |
| `waiting_retry` | `queued` | Retry delay elapsed (`next_retry_at <= now`) | Orchestrator/retry scheduler | No | Retry scheduling only |
| `waiting_retry` | `cancelled` | Workflow cancelled during retry wait | Orchestrator | Yes | |

Notes:
- `skipped` exists in schema but is not used in MVP (see Section 10).
- No transitions are allowed out of terminal activity statuses (`completed`, `failed`, `cancelled`, `skipped`).

## 8) Activity Handler Contract (Runtime Convention)

Input must include:
1. `workflow_run_id`
2. `activity_run_id`
3. current `workflow_context`
4. `activity_input_payload`

Recommended metadata in input:
1. `activity_key`
2. `handler_key`
3. workflow definition key/version identifiers
4. `attempt_count` and `max_attempts`
5. trace/timing metadata (`claimed_at`, `lease_expires_at`, correlation/request id)

Output contract must include:
1. `output_payload` on success
2. optional `context_patch`
3. terminal error classification for failures (`retryable` vs `terminal`)

Behavioral rules:
1. Success: orchestrator sets activity `completed`, writes `output_payload`, merges `context_patch` if provided, and schedules downstream.
2. Retryable failure: orchestrator sets `waiting_retry`, persists error metadata, computes `next_retry_at`.
3. Terminal failure: orchestrator sets `failed`; workflow failure policy may set workflow to `failed`.
4. Handlers are not allowed to mutate shared workflow state directly.

## 9) Ownership Boundaries

Orchestrator owns:
1. Workflow status transitions.
2. Activity status transitions.
3. Queue claim/scheduling state transitions.
4. Downstream scheduling decisions.
5. Context merge and writes to `workflow_runs.context`.
6. Persistence of activity outputs/errors and event emission.

Handler owns:
1. Business logic execution only.
2. Returning structured success/failure result objects.
3. Declaring retryable vs terminal classification for failures.

Handler must not:
1. Directly update `workflow_runs`.
2. Directly update `activity_runs` state fields outside orchestrator contract.
3. Directly enqueue downstream activities.

## 10) MVP Decision: `skipped`

Decision: `skipped` is explicitly NOT used in MVP runtime behavior.

Rationale:
1. MVP focuses on deterministic core lifecycle (`completed`, `failed`, `waiting_retry`, `cancelled`).
2. Skip semantics require branch/condition execution policy that is deferred.
3. Keeping `skipped` unused avoids ambiguity while execution engine is being introduced.

Implication:
- Existing helper semantics that consider `skipped` as satisfiable predecessor remain acceptable for forward compatibility, but orchestration implementation in MVP should not actively set `activity_runs.status = skipped`.

## 11) MVP In Scope vs Deferred

In scope for MVP contract lock:
1. Status transition legality.
2. Handler input/output shape.
3. Ownership boundaries.
4. Retry and lease behavior conventions.

Deferred to later implementation phases:
1. Worker runtime and polling loops.
2. Concrete lease monitor and retry scheduler jobs.
3. Condition expression execution semantics and branch skipping.
4. Detailed deterministic merge algorithm for concurrent context patches.
5. Backoff algorithm details beyond existing schema fields.
