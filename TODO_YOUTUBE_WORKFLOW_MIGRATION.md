# YouTube Processing Workflow Migration — Implementation TODO

> **Status legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[-]` skipped/obsolete
> **Last reviewed:** 2026-04-30

---

## Current State Snapshot (verified 2026-04-30)

Confirmed in repo / DB:

- Workflow engine is live with definitions: `document_processing_v1`, `validation.fanin.basic`, `validation.fanout.basic`, `validation.multi_entry.basic`. **No `youtube_processing_v1` yet.**
- YouTube processing still runs through the **legacy path**: `youtube_transcript_jobs` table + `supabase/functions/youtube-transcript-worker/` (claim/run/complete loop, separate from `workflow-worker`).
- Transcript fetcher lives in `youtube-transcript-worker/transcript-fetcher.ts` (SerpApi primary).
- Transcript chunk + embedding persistence lives in `youtube-transcript-worker/chunk-persistence.ts`.
- `link_transcript_chunks` and `link_transcript_chunk_questions` tables exist with embeddings + search_vector and proper RLS.
- Hybrid retrieval already includes transcript chunk-question semantic search.
- UI: linked YouTube videos show in project + notebook Manage documents with status, readiness, metrics. Timeline section still uses placeholder data (not workflow-native).
- `youtube_transcript_jobs` currently has 0 rows → safe migration window, no in-flight legacy work to drain.

### Already done (carried over)
- [x] SerpApi as primary transcript provider
- [x] Persist transcript chunks + chunk embeddings (`link_transcript_chunks`)
- [x] Persist transcript chunk-questions + question embeddings (`link_transcript_chunk_questions`)
- [x] Hybrid retrieval includes transcript chunk-questions
- [x] Transcript debug diagnostics surfaced in UI
- [x] Linked-video cards in project + notebook Manage documents

### Net remaining goal
Move the working monolith pipeline into the workflow engine (`workflow-worker` handlers + a `youtube_processing_v1` definition), then decommission the legacy queue worker.

---

## Phase 1 — Workflow Foundation for YouTube  ⬅ **START HERE**

Goal: register a `youtube_processing_v1` workflow definition and wire trigger entry.

- [ ] **1.1** Create `youtube_processing_v1` workflow definition (migration) with activities:
  - `classify_resource`
  - `fetch_transcript`
  - `persist_transcript_chunks`
  - `generate_transcript_chunk_embeddings`
  - `generate_transcript_chunk_questions`
  - `generate_transcript_question_embeddings`
  - `finalize_resource_status`
- [ ] **1.2** Add `handler_key` mapping for each activity in `workflow-worker/handler-registry.ts` (handlers can be stubs that delegate to existing `youtube-transcript-worker` modules in Phase 2).
- [ ] **1.3** Add a feature flag column / setting (e.g. `metadata.use_workflow_engine` on `resource_links`, or env flag `YOUTUBE_USE_WORKFLOW=1`) so we can route per-resource between legacy and workflow paths during rollout.
- [ ] **1.4** Update link adapter / `create_link_resource_stub` consumer to call `workflow-start` with `youtube_processing_v1` when flag is on (idempotency key: `resource_link_id + transcript_version`).
- [ ] **1.5** Verify activity runs appear in existing workflow diagnostics SQL (`sql/debug/2_activity_states_latest_workflow.sql`).

**Acceptance:** A YouTube link added with the flag on creates a `workflow_runs` row + `activity_runs` rows visible in diagnostics. Legacy path remains default for safety.

---

## Phase 2 — Activity Implementation (port logic into handlers)

- [ ] **2.1** `classify_resource` — validate provider, canonicalize video id (reuse helpers from `transcript-fetcher.ts`).
- [ ] **2.2** `fetch_transcript` — port SerpApi fetch + structured failure taxonomy (`no_track`, `blocked`, `transient_network`, `parse_error`).
- [ ] **2.3** `persist_transcript_chunks` — port from `chunk-persistence.ts`.
- [ ] **2.4** `generate_transcript_chunk_embeddings` — reuse shared embeddings helper.
- [ ] **2.5** `generate_transcript_chunk_questions` — extract from existing inline code.
- [ ] **2.6** `generate_transcript_question_embeddings`.
- [ ] **2.7** `finalize_resource_status` — set `transcript_status`, `processing_status`, summary metadata.
- [ ] **2.8** Each activity: structured error returns (`HandlerFailure` with classification + category) so retries follow workflow semantics.

**Acceptance:** End-to-end workflow run for a real YouTube URL produces same DB rows as legacy path (chunks, questions, embeddings) and finalizes resource status.

---

## Phase 3 — Retrieval Parity Verification

Most of this is already implemented; this phase is regression check only.

- [x] Transcript chunk-question semantic search wired in hybrid retrieval
- [ ] **3.1** Add a regression query (sql/debug) confirming workflow-produced chunks are indexed identically (same `embedding_version`, same `search_vector` population).
- [ ] **3.2** Confirm source attribution UI labels workflow-produced transcript chunks correctly in chat answers.

---

## Phase 4 — UX + Observability

- [ ] **4.1** Replace placeholder timeline in linked-video cards with workflow-native activity_runs timeline (project Manage documents).
- [ ] **4.2** Same for notebook Manage documents.
- [ ] **4.3** Per-stage error display + retry affordance (trigger workflow retry, not legacy `enqueue_youtube_transcript_job`).
- [ ] **4.4** Resource-level diagnostic fields exposed: `last_activity_key`, `last_activity_status`, `last_failure_reason`.

---

## Phase 5 — Cutover

- [ ] **5.1** Flip feature flag default to **workflow path** for new resources.
- [ ] **5.2** Backfill / re-run path for existing YouTube resources missing chunks or questions.
- [ ] **5.3** Update `useRetryYouTubeTranscriptIngestion` to call workflow retry RPC instead of `enqueue_youtube_transcript_job`.
- [ ] **5.4** Monitor for 1 week.

---

## Phase 6 — Legacy Decommission

- [ ] **6.1** Mark `youtube_transcript_jobs` + RPCs (`enqueue_youtube_transcript_job`, `claim_next_youtube_transcript_job`, `complete_youtube_transcript_job`) as deprecated in code comments.
- [ ] **6.2** Remove cron schedule for `youtube-transcript-worker`.
- [ ] **6.3** Delete `supabase/functions/youtube-transcript-worker/` (keep modules reused by handlers under `_shared/`).
- [ ] **6.4** Drop `youtube_transcript_jobs` table (migration) once 30-day retention window passes with zero traffic.

---

## Milestone Checklist (high-level)

- [ ] Phase 1 — workflow definition + flagged trigger
- [ ] Phase 2 — handlers implemented end-to-end
- [ ] Phase 3 — retrieval parity confirmed
- [ ] Phase 4 — workflow-native UI + retry
- [ ] Phase 5 — cutover complete
- [ ] Phase 6 — legacy removed

---

## Suggested First Step

**Start with Phase 1.1 + 1.2** — a single migration that registers the `youtube_processing_v1` workflow definition with all 7 activities (handlers as stubs returning `ok: true` with empty payload), plus stub handler entries in `workflow-worker/handler-registry.ts`. This is low-risk (no behavior change — legacy path still runs by default) and gives us:

1. A real workflow definition we can trigger manually via `workflow-start` for smoke testing.
2. Visibility in existing diagnostics SQL.
3. A scaffold for Phase 2 to fill in stage-by-stage without blocking on UI/cutover decisions.

**Shall I proceed with the Phase 1.1 + 1.2 migration + stub handlers?**
