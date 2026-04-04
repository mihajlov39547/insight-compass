# Phase D - Background Workflow Execution Activation

Status: active.

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

## Document Processing

Document processing runs exclusively through the durable workflow engine:
- Uploads trigger `workflow-start` for definition `document_processing_v1`
- Cron-driven `workflow-worker` claims and executes document processing activities
- `workflow-maintenance` handles stale recovery

## What Remains Deferred

- pgmq activation
- Full observability/admin tooling
