# Phase E — Shadow Mode for Document Workflow Processing

**Status**: Active (non-production/shadow mode only)  
**Date**: 2026-03-31  
**Scope**: Additive shadow comparison layer — no production cutover

---

## 1. Overview

Phase E enables running the durable workflow engine in parallel with the existing
`process-document` production path for selected documents. The production path
remains authoritative and user-visible. Shadow mode exists only for validation,
comparison, and confidence-building before any future cutover.

---

## 2. Architecture

```
User Upload
    │
    ▼
process-document (production — unchanged)
    │
    ├─ writes to documents, document_analysis, document_chunks, etc.
    │
    ▼ (on success, if SHADOW_MODE_ENABLED=true and document matches filters)
    │
    ├── fire-and-forget: POST /functions/v1/workflow-shadow-start
    │       └── creates workflow_run with shadow_mode=true
    │
    ▼
pg_cron workflow-worker-shadow (every 2 min)
    │
    ├── claims activities from shadow workflow runs
    ├── detects shadow_mode=true in workflow_context
    ├── routes to READ-ONLY shadow handlers
    │     └── reads production tables (snapshot), returns output_payload
    │     └── does NOT write to production tables
    ▼
shadow-compare (manual invocation)
    └── compares production results vs shadow workflow output
```

---

## 3. Shadow Selection / Feature Gating

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `SHADOW_MODE_ENABLED` | Master switch. Must be `"true"` to enable shadow triggering | unset (disabled) |
| `SHADOW_MODE_USER_IDS` | Comma-separated list of user UUIDs to limit shadow to | empty (all users if enabled) |
| `SHADOW_MODE_PROJECT_IDS` | Comma-separated list of project UUIDs to limit shadow to | empty (all projects if enabled) |

### How selection works

1. After `process-document` completes successfully, it checks `SHADOW_MODE_ENABLED`
2. If enabled, checks `SHADOW_MODE_USER_IDS` and `SHADOW_MODE_PROJECT_IDS`
3. If user/project match (or lists are empty = all match), fires shadow workflow start
4. The trigger is fire-and-forget — production response is not delayed

### How to enable

Set the secrets on the Edge Functions:
```bash
# Enable for all users/projects
SHADOW_MODE_ENABLED=true

# Enable for specific users only
SHADOW_MODE_ENABLED=true
SHADOW_MODE_USER_IDS=uuid-1,uuid-2

# Enable for specific projects only
SHADOW_MODE_ENABLED=true
SHADOW_MODE_PROJECT_IDS=project-uuid-1
```

### How to disable

Remove or unset `SHADOW_MODE_ENABLED`, or set it to any value other than `"true"`.

---

## 4. Non-Interference Strategy

**Decision: Read-only shadow handlers (Option A from spec)**

Shadow workflow handlers do NOT write to production tables. Instead:

1. When the workflow worker detects `shadow_mode: true` in `workflow_context`,
   it routes document handler keys to shadow-safe variants
2. Shadow handlers read current production state from:
   - `documents` (processing_status, detected_language, summary, word_count, etc.)
   - `document_analysis` (extracted_text metadata, search index state)
   - `document_chunks` (count, embedding presence)
   - `document_chunk_questions` (count, embedding presence)
3. Results are captured in `activity_runs.output_payload` and flow through
   `context_patch` into `workflow_runs.context`
4. No writes to production tables occur during shadow execution

### Tables protected from shadow writes

| Table | Protection |
|-------|-----------|
| `documents` | Shadow handlers do not UPDATE |
| `document_analysis` | Shadow handlers do not UPSERT/UPDATE |
| `document_chunks` | Shadow handlers do not INSERT/DELETE |
| `document_chunk_questions` | Shadow handlers do not INSERT/DELETE |

### What shadow handlers DO write to

| Table | What | Purpose |
|-------|------|---------|
| `activity_runs.output_payload` | Snapshot data | Captured by worker loop |
| `workflow_runs.context` | Context patches | Merged by orchestrator |
| `workflow_events` | Lifecycle events | Standard workflow audit |
| `activity_attempts` | Attempt records | Standard attempt tracking |
| `workflow_context_snapshots` | Context snapshots | Standard context audit |

---

## 5. Comparison

### Edge Function: `shadow-compare`

**Endpoint**: `POST /functions/v1/shadow-compare`

**Request body:**
```json
{
  "document_id": "uuid-of-document",
  "workflow_run_id": "optional-specific-workflow-run-id"
}
```

**Response:**
```json
{
  "document_id": "...",
  "comparison_status": "equivalent" | "divergent" | "no_shadow_run",
  "production": {
    "processing_status": "completed",
    "detected_language": "sr",
    "summary_present": true,
    "summary_length": 450,
    "word_count": 1234,
    "char_count": 7890,
    "chunk_count": 12,
    "embedded_chunk_count": 12,
    "question_count": 18,
    "embedded_question_count": 18
  },
  "shadow": {
    "workflow_run_id": "...",
    "workflow_status": "completed",
    "detected_language": "sr",
    "summary_present": true,
    "chunk_count": 12,
    "embeddings_generated": 12,
    "questions_generated": 18,
    "activities": [...]
  },
  "diff": {
    "detected_language": "match",
    "summary_present": "match",
    "word_count": "match",
    "chunk_count": "match",
    "completion_status": {
      "production_completed": true,
      "shadow_completed": true,
      "both_completed": true
    }
  },
  "warnings": [],
  "message": "Production and shadow paths produced equivalent results"
}
```

### Manual comparison flow

```bash
# 1. Upload a document (triggers process-document as normal)
# 2. Wait for processing to complete
# 3. If shadow mode is enabled, a shadow workflow was auto-triggered
# 4. Wait for shadow workflow to complete (cron processes every 2 min)

# 5. Run comparison
curl -X POST \
  https://mdrxzwudhtmkyqcxwvcy.supabase.co/functions/v1/shadow-compare \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <service-role-key>" \
  -d '{"document_id": "uuid-of-document"}'
```

---

## 6. Correlation and Traceability

Every shadow workflow run includes:

| Field | Location | Value |
|-------|----------|-------|
| `shadow_mode` | `workflow_runs.input_payload` | `true` |
| `shadow_reason` | `workflow_runs.input_payload` | `"upload_shadow_validation"` |
| `shadow_started_at` | `workflow_runs.input_payload` | ISO timestamp |
| `document_id` | `workflow_runs.input_payload` | Source document UUID |
| `trigger_entity_type` | `workflow_runs` column | `"document"` |
| `trigger_entity_id` | `workflow_runs` column | Source document UUID |
| `idempotency_key` | `workflow_runs` column | `"shadow-upload-{document_id}"` |

### Querying shadow runs for a document

```sql
SELECT id, status, created_at, completed_at, input_payload
FROM workflow_runs
WHERE trigger_entity_type = 'document'
  AND trigger_entity_id = '<document-uuid>'
  AND (input_payload->>'shadow_mode')::boolean = true
ORDER BY created_at DESC;
```

---

## 7. Shadow Handler Routing

The handler dispatch logic in `registry.ts` detects `shadow_mode: true` in
`workflow_context` and routes document handler keys to read-only equivalents:

| Production Handler Key | Shadow Handler |
|----------------------|----------------|
| `document.prepare_run` | `shadowPrepareRun` |
| `document.load_source` / `document.load` | `shadowLoadSource` |
| `document.extract_text` | `shadowExtractText` |
| `document.assess_quality` | `shadowAssessQuality` |
| `document.detect_language_and_stats` | `shadowDetectLanguageAndStats` |
| `document.generate_summary` / `document.summarize` | `shadowGenerateSummary` |
| `document.build_search_index` | `shadowBuildSearchIndex` |
| `document.chunk_text` / `document.chunk` | `shadowChunkText` |
| `document.generate_chunk_embeddings` | `shadowGenerateChunkEmbeddings` |
| `document.generate_chunk_questions` | `shadowGenerateChunkQuestions` |
| `document.finalize_document` / `document.finalize` | `shadowFinalizeDocument` |

Non-document handlers (debug.*) are unaffected by shadow mode.

---

## 8. Idempotency

Shadow workflow starts use idempotency key `shadow-upload-{document_id}`.
This prevents duplicate shadow runs when:
- `process-document` is retried for the same document
- Multiple concurrent uploads finish for the same document

---

## 9. Validation

### What to verify

| Check | How |
|-------|-----|
| Normal uploads trigger process-document | Upload a document, check `documents.processing_status` |
| Shadow workflow is created for matching docs | Check `workflow_runs` with `shadow_mode=true` |
| Non-matching docs don't get shadow runs | Upload from non-listed user/project, verify no shadow run |
| Shadow handlers don't modify production state | Compare `documents` row before/after shadow run |
| Comparison output is generated | Call `shadow-compare` with a processed document |
| Cron picks up shadow activities | Check `activity_runs` status progression |

### Validation commands

```bash
# Check shadow workflow exists for a document
# SELECT id, status, (input_payload->>'shadow_mode') as shadow
# FROM workflow_runs
# WHERE trigger_entity_id = '<doc-id>'
# ORDER BY created_at DESC;

# Check shadow activity execution
# SELECT activity_key, status, output_payload->>'shadow_mode' as shadow
# FROM activity_runs
# WHERE workflow_run_id = '<shadow-run-id>'
# ORDER BY created_at;

# Run comparison
curl -X POST \
  https://mdrxzwudhtmkyqcxwvcy.supabase.co/functions/v1/shadow-compare \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <service-role-key>" \
  -d '{"document_id": "<doc-id>"}'
```

---

## 10. Files Created/Modified

| File | Action | Purpose |
|------|--------|---------|
| `supabase/functions/process-document/index.ts` | Modified | Added feature-flagged shadow trigger after successful completion |
| `supabase/functions/workflow-worker/handlers/shadow-document.ts` | Created | Read-only shadow document handlers |
| `supabase/functions/workflow-worker/registry.ts` | Modified | Shadow handler routing when shadow_mode detected |
| `supabase/functions/shadow-compare/index.ts` | Created | Comparison edge function |
| `docs/workflows/phase-e-shadow-mode.md` | Created | This document |

---

## 11. Production Safety

### What was NOT changed

- `process-document` remains the primary production path for all uploads
- Upload flow in `useDocuments.ts` unchanged
- Dashboard document status display unchanged
- Document tables not modified by shadow execution
- No schema changes
- No RLS changes
- No migration changes
- No UI changes

### How to verify production is unaffected

1. Upload a document — it processes through `process-document` as before
2. Check `documents.processing_status` — set by `process-document`, not shadow
3. Shadow trigger is fire-and-forget — does not affect production response
4. Shadow handlers only READ from production tables

---

## 12. What Remains Deferred

| Item | Status | Target Phase |
|------|--------|-------------|
| Production cutover to workflow engine | Not started | Future phase |
| Upload hook change to workflow-start | Not started | Future phase |
| UI migration to workflow-driven status | Not started | Future phase |
| pgmq activation | Deferred | Future throughput phase |
| Conditional edge evaluation | Schema-ready | Future |
| Admin/observability UI | Not started | Future |

---

## 13. Confirmation Checklist

- [x] `process-document` remains the primary production path
- [x] No production cutover happened
- [x] User-visible primary processing remains unchanged
- [x] Shadow handlers are read-only and do not write production data
- [x] Shadow workflow start is feature-flagged and controllable
- [x] Comparison function provides structured diff output
- [x] Idempotency prevents duplicate shadow runs
- [x] All changes are additive only
- [x] No existing functionality modified outside shadow-mode additions
