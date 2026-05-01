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

## Phase 1 — Workflow Foundation for YouTube  ✅ **DONE**

Goal: register a `youtube_processing_v1` workflow definition and wire trigger entry.

- [x] **1.1** Create `youtube_processing_v1` workflow definition (migration `20260430135137_*`) with 7 activities, linear edge graph, entry=`classify_resource`, terminal=`finalize_resource_status`, optional=question stages.
- [x] **1.2** Stub handlers + registry entries (`workflow-worker/handlers/youtube.ts` + `registry.ts`). All 7 handler keys return `ok:true` with inert payload.
- [x] **1.3** Feature flag plumbing: `app_feature_flags` table + `is_feature_enabled(text)` RPC. Seeded `youtube_use_workflow = false` (off by default).
- [x] **1.4** Client wiring: `useCreateLinkResource` calls `workflow-start` with `youtube_processing_v1` (idempotency key `youtube-workflow-<resource_id>`) when flag is on. Legacy `enqueue_youtube_transcript_job` inside the SQL stub still runs in parallel as safety net during dual-write window.
- [x] **1.5** Smoke test: flag flipped to `true`, YouTube link added, confirmed `workflow_runs` + 7 `activity_runs` rows for `youtube_processing_v1` all completed. Both legacy + workflow ran in parallel. ✅

**Acceptance:** ✅ Complete. Both paths ran and succeeded.

---

## Phase 2 — Activity Implementation (port logic into handlers)  ✅ **DONE**

- [x] **2.1** `classify_resource` — validates provider, canonicalizes video ID from URL, sets `transcript_status=processing`.
- [x] **2.2** `fetch_transcript` — reuses `fetchTranscriptForVideo` from legacy `transcript-fetcher.ts`, persists debug + title metadata, structured `retryable`/`terminal` errors.
- [x] **2.3** `persist_transcript_chunks` — reuses `buildTranscriptChunks` from `chunk-persistence.ts`, inserts into `link_transcript_chunks` (embeddings deferred to next activity).
- [x] **2.4** `generate_transcript_chunk_embeddings` — `generateEmbeddingsLocal` for all chunks, updates rows with null embedding.
- [x] **2.5** `generate_transcript_chunk_questions` — AI (Lovable Gateway) with local-template fallback, inserts into `link_transcript_chunk_questions`.
- [x] **2.6** `generate_transcript_question_embeddings` — `localEmbedding` per question, updates rows.
- [x] **2.7** `finalize_resource_status` — generates summary via `generateDocumentSummary`, sets `transcript_status=ready`, persists final metrics.
- [x] **2.8** All activities return structured `HandlerFailure` with `classification` + `category` for proper retry semantics.

**Acceptance:** Handlers now contain real logic. Next: end-to-end test with a new YouTube link to verify workflow-produced data matches legacy output.

---

## Phase 3 — Retrieval Parity Verification  ✅ **DONE**

Most of this is already implemented; this phase is regression check only.

- [x] Transcript chunk-question semantic search wired in hybrid retrieval
- [x] **3.1** Regression query `sql/debug/6_youtube_retrieval_parity.sql` confirms all chunks have embedding + search_vector, all questions have embedding, `embedding_version = local-hash-v1`. Both videos show ✅ across all parity checks.
- [x] **3.2** Source attribution: hybrid retrieval uses `search_link_transcript_chunks` / `search_link_transcript_chunk_questions` RPCs which query by `embedding` and `search_vector` — identical indexing schema regardless of producer (legacy vs workflow). No UI changes needed.

---

## Phase 4 — UX + Observability  ✅ **DONE**

- [x] **4.1** Replace placeholder timeline in linked-video cards with workflow-native `activity_runs` timeline (project Manage documents). New hook `useResourceWorkflowTimeline` fetches real data; falls back to legacy debug when no workflow run exists.
- [x] **4.2** Same for notebook Manage documents — `LinkedVideoRow` is shared, so both dashboards are covered.
- [x] **4.3** Per-stage error display + retry affordance. Timeline now shows per-activity duration, attempt count (×N), and error messages. `useRetryYouTubeTranscriptIngestion` uses `workflow-start` with a fresh idempotency key when the flag is on, falling back to legacy `enqueue_youtube_transcript_job`.
- [x] **4.4** Resource-level diagnostic fields exposed via workflow timeline: last completed activity, workflow status, per-activity error messages visible in the timeline detail column.

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

- [x] Phase 1 — workflow definition + flagged trigger
- [x] Phase 2 — handlers implemented end-to-end
- [x] Phase 3 — retrieval parity confirmed
- [x] Phase 4 — workflow-native UI + retry
- [ ] Phase 5 — cutover complete
- [ ] Phase 6 — legacy removed

---

## Suggested Next Step

**Test Phase 2 end-to-end**: Add a new YouTube link (with the flag already on) and verify the workflow-produced chunks, embeddings, questions, and summary match what the legacy worker produces. Then proceed to **Phase 3** retrieval parity verification.
