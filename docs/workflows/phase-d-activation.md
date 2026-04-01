# Phase D - Background Workflow Execution Activation

Status: active, additive, rollback-ready.

## Goal

Activate pg_cron-driven background workflow execution for the durable workflow engine.

## pgmq Decision

**Deferred.** DB-backed claim orchestration via `claim_next_activity()` / `FOR UPDATE SKIP LOCKED` remains the source of truth. pgmq stays schema-ready only.

## Cron Schedules

Two cron jobs are configured for background workflow processing:

### workflow-worker (every 2 minutes)

| Field | Value |
|-------|-------|
| Schedule | `*/2 * * * *` |
| Target | `workflow-worker` Edge Function |
| Payload | `{"max_activities_to_process": 3, "lease_seconds": 300, "debug": true}` |

### workflow-maintenance (every 5 minutes)

| Field | Value |
|-------|-------|
| Schedule | `*/5 * * * *` |
| Target | `workflow-maintenance` Edge Function |
| Payload | `{"max_records": 20, "stale_before_seconds": 0, "dry_run": false, "actor": "cron-maintenance"}` |

## Disabling Cron Schedules

```sql
SELECT cron.unschedule('workflow-worker');
SELECT cron.unschedule('workflow-maintenance');
```

## Production Safety

- Document processing path is controlled solely by `VITE_DOCUMENT_WORKFLOW_CUTOVER_DISABLED` (see Phase F docs)
- When workflow cutover is enabled (default), uploads go through `workflow-start`
- When disabled, uploads fall back to `process-document`
- Cron schedules only process activities that have been explicitly created via workflow-start

## What Remains Deferred

- pgmq activation
- Full observability/admin tooling
