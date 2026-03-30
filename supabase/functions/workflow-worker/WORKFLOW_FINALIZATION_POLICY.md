# Phase 8 Workflow Finalization Policy

## Scope

This policy defines workflow-level terminal status transitions for the durable workflow engine MVP.

## Authoritative Rule

Workflow finalization is aggregate runtime-state based and uses activity_runs status state.

1. Keep workflow running when any activity is in:
   - pending
   - queued
   - claimed
   - running
   - waiting_retry
2. Finalize workflow failed when any required activity is terminal:
   - failed
   - cancelled
3. Finalize workflow completed when:
   - no activity is in-progress
   - no required activity is failed/cancelled

## Optional Activity Semantics

Optional activities may fail/cancel without forcing workflow failure.
Workflow can still complete if required work is terminally successful and no in-progress work remains.

## is_terminal Activity Definition Flag

In MVP, is_terminal on workflow_activities has no extra workflow-level finalization semantics.
Finalization is determined by aggregate runtime state only.

## Cancellation and Timeout

workflow_runs statuses cancelled and timed_out remain control-plane reserved in this phase.
This finalizer does not produce those statuses.

## Output Payload Rule

workflow_runs.output_payload is written during the final terminal transition only.
Repeated finalization calls do not rewrite output_payload.

## Event Deduplication

Terminal workflow events are emitted only when a terminal status update is actually applied
via a conditional transition from pending/running to completed/failed.
Concurrent or repeated calls are no-op for event emission.
