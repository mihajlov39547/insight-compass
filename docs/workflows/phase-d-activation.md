# Phase D — Background Workflow Execution Activation

**Status**: Active (non-production/shadow mode only)  
**Date**: 2026-03-31  
**Scope**: Additive infrastructure activation — no production cutover

---

## 1. Overview

Phase D activates cron-triggered background execution for the durable workflow engine.
This enables the engine to process workflow activities automatically without manual invocation,
but **only in a non-production/shadow path**. Production document processing remains on the
existing `process-document` Edge Function.

---

## 2. pgmq Decision

**Decision: Deferred.**

Rationale:
- The claim-based DB orchestration (`claim_next_activity()` with `FOR UPDATE SKIP LOCKED`) is
  already the authoritative execution source of truth
- pgmq would add operational complexity without providing meaningful value at this stage
- The `queue_dispatches` table remains schema-ready for future pgmq integration
- The worker loop already supports bounded processing, retry pickup, and lease-based concurrency
- Adding pgmq now would require wiring dispatch/dequeue logic without clear benefit over
  the existing DB-poll model

**Future activation path**: When throughput requirements exceed what cron-polled DB claims can
sustain, pgmq can be activated as a dispatch/notification layer while `activity_runs` remains
the authoritative state.

---

## 3. Cron Schedules

### 3.1 Workflow Worker (`workflow-worker-shadow`)

| Field | Value |
|-------|-------|
| Schedule | Every 2 minutes (`*/2 * * * *`) |
| Target | `workflow-worker` Edge Function |
| Payload | `{"max_activities_to_process": 3, "lease_seconds": 300, "debug": true}` |
| Purpose | Claims and executes queued/retryable workflow activities |

**Bounded processing guarantees:**
- Max 3 activities per invocation (hardcoded in payload)
- Worker loop caps at 5 even if payload requests more
- 300-second lease prevents double-processing
- `FOR UPDATE SKIP LOCKED` prevents concurrent claim conflicts
- Debug logging enabled for shadow observability

### 3.2 Stale Recovery Worker (`workflow-maintenance-shadow`)

| Field | Value |
|-------|-------|
| Schedule | Every 5 minutes (`*/5 * * * *`) |
| Target | `workflow-maintenance` Edge Function |
| Payload | `{"max_records": 20, "stale_before_seconds": 0, "dry_run": false, "actor": "cron-maintenance"}` |
| Purpose | Recovers activities stuck in claimed/running with expired leases |

**Bounded processing guarantees:**
- Max 20 stale records per scan
- Only processes activities with expired `lease_expires_at`
- Respects retry budget before terminal failure
- Writes recovery events for audit trail

---

## 4. How to Disable Cron Schedules

To stop background execution:

```sql
-- Disable workflow worker
SELECT cron.unschedule('workflow-worker-shadow');

-- Disable stale recovery worker
SELECT cron.unschedule('workflow-maintenance-shadow');
```

To re-enable, re-run the schedule creation SQL from the insert step.

To list active schedules:
```sql
SELECT jobid, jobname, schedule, command FROM cron.job;
```

---

## 5. Shadow Workflow Start

### Edge Function: `workflow-shadow-start`

A dev-only endpoint for manually triggering workflow runs without touching production uploads.

**Endpoint**: `POST /functions/v1/workflow-shadow-start`

**Request body:**
```json
{
  "definition_key": "document_processing_v1",
  "document_id": "uuid-of-document",
  "user_id": "uuid-of-user",
  "idempotency_key": "optional-dedup-key",
  "shadow_reason": "testing Phase D activation"
}
```

**Behavior:**
- Reads document metadata (read-only) and passes it as workflow input
- Sets `shadow_mode: true` in the input payload for traceability
- Does NOT modify the `documents` table
- Does NOT change `processing_status`
- Uses the standard `startWorkflowRunMaterialization` service
- Workflow runs created here are processed by the cron-triggered worker

**Safety guarantees:**
- All workflow runs carry `shadow_mode: true` in input_payload
- `trigger_entity_type` is set to `"document"` for traceability
- Production `process-document` is completely untouched
- No UI routes to this endpoint

---

## 6. Production Isolation

| Concern | Isolation mechanism |
|---------|-------------------|
| Document uploads | Still routed to `process-document` only |
| Workflow creation | Only via `workflow-shadow-start` (manual/dev) |
| Worker execution | Cron jobs named `*-shadow` for clarity |
| Data separation | Shadow runs carry `shadow_mode: true` metadata |
| UI impact | None — no UI changes in Phase D |
| Rollback | `cron.unschedule()` immediately stops background processing |

---

## 7. Verification Approach

### 7.1 Bounded Processing
- Worker processes max 3 activities per cron invocation
- Worker loop has hard cap of 5 iterations
- No unbounded loops exist in the execution path

### 7.2 Retry Pickup
- Activities in `waiting_retry` with `next_retry_at <= now()` are claimed by `claim_next_activity()`
- Cron runs every 2 minutes, ensuring retries are picked up within that window
- Retry backoff is computed deterministically by `computeNextRetrySchedule()`

### 7.3 Stale Recovery
- Maintenance worker scans `claimed`/`running` activities with expired leases
- Recovers to `queued` or `waiting_retry` based on retry budget
- Marks terminal if budget exhausted
- Runs independently every 5 minutes

### 7.4 No Infinite Churn
- Each invocation is bounded by `max_activities_to_process`
- Each activity has `max_attempts` enforced
- Terminal failures are permanent
- Workflow finalization is idempotent

### 7.5 Manual Validation Steps
```bash
# 1. Check cron jobs are active
# Run in SQL editor:
# SELECT jobid, jobname, schedule FROM cron.job;

# 2. Start a shadow workflow (requires a seeded workflow definition)
curl -X POST \
  https://mdrxzwudhtmkyqcxwvcy.supabase.co/functions/v1/workflow-shadow-start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <anon-key>" \
  -d '{"definition_key": "document_processing_v1", "shadow_reason": "phase-d-validation"}'

# 3. Observe activity processing
# SELECT id, activity_key, status, attempt_count FROM activity_runs
# WHERE workflow_run_id = '<id-from-step-2>' ORDER BY created_at;

# 4. Check workflow events
# SELECT event_type, actor, created_at, details
# FROM workflow_events WHERE workflow_run_id = '<id>'
# ORDER BY created_at;

# 5. Verify worker ran via cron
# SELECT * FROM cron.job_run_details
# WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'workflow-worker-shadow')
# ORDER BY start_time DESC LIMIT 5;
```

---

## 8. What Remains Deferred

| Item | Status | Target Phase |
|------|--------|-------------|
| pgmq activation | Schema-ready, deferred | Future throughput phase |
| Production document cutover | Not started | Phase E |
| Upload hook change | Not started | Phase E |
| Conditional edge evaluation | Schema-ready, deferred | Future |
| Workflow timeout enforcement | Stored but not enforced | Future |
| Admin/observability UI | Not started | Future |
| `workflow_context_patched` event type | Needs enum addition | Phase E or patch |

---

## 9. Files Created/Modified in Phase D

| File | Action | Purpose |
|------|--------|---------|
| `supabase/functions/workflow-shadow-start/index.ts` | Created | Shadow workflow start endpoint |
| `docs/workflows/phase-d-activation.md` | Created | This document |
| Migration (pg_cron + pg_net extensions) | Created | Enable cron/HTTP scheduling extensions |
| SQL insert (cron.schedule) | Executed | Create shadow cron schedules |

---

## 10. Confirmation Checklist

- [x] `process-document` remains the active production path
- [x] Uploads are not routed to workflow engine
- [x] No production traffic was switched
- [x] No existing functionality was modified
- [x] pgmq is deferred (documented above)
- [x] Workflow worker is cron-invoked safely (bounded, leased)
- [x] Stale recovery is cron-invoked safely (bounded, scoped)
- [x] Shadow execution is isolated from production
- [x] All changes are additive only
