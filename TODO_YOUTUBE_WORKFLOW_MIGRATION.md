# YouTube Processing Workflow Migration — Implementation TODO

## Scope

Migrate YouTube processing from the current queue + standalone worker model into the platform workflow engine used for documents, then clean up legacy paths, and reach document-parity retrieval quality (including chunk-question generation + question embeddings).

---

## Base Snapshot (Current)

Current YouTube processing is functional but separate from document workflow orchestration:

1. Link adapter marks YouTube resources and enqueues transcript jobs
2. `youtube_transcript_jobs` + `youtube-transcript-worker` handle claim/run/complete
3. Transcript text is fetched from YouTube timedtext endpoints
4. Transcript chunks and embeddings are persisted in `link_transcript_chunks`
5. Retrieval includes transcript chunks via `search_link_transcript_chunks`
6. Transcript chunk-question generation and question embeddings are not yet implemented
7. Lifecycle and observability differ from document activity-run model

This TODO focuses on convergence to a unified workflow architecture.

---

## Target End State

1. YouTube processing is fully orchestrated by workflow definitions/activity runs
2. No separate transcript job queue is needed for primary path
3. YouTube pipeline has stage parity with document pipeline where applicable
4. Transcript chunks, chunk-questions, and question embeddings are available for retrieval
5. Chat grounding behavior is consistent between document and YouTube transcript sources
6. Legacy queue worker path is removed or retained only as explicit fallback with clear boundary

---

## Phase 1 — Workflow Foundation for YouTube

### Goal
Introduce a dedicated workflow definition for YouTube processing with activity-run lifecycle.

### Steps
1. Create workflow definition key (example: `youtube_processing_v1`)
2. Define workflow graph with activities:
   - classify_resource
   - fetch_transcript
   - persist_transcript_chunks
   - generate_transcript_chunk_embeddings
   - finalize_resource_status
3. Add trigger path from link adapter/enqueue entry points to `workflow-start`
4. Ensure idempotency per resource/version (resource_id + normalized_url + transcript_version key)
5. Add workflow event logging for each activity transition

### Acceptance criteria
- New YouTube resources start via workflow engine
- Activity runs visible in existing workflow diagnostics
- Retries handled through workflow semantics instead of custom queue semantics

---

## Phase 2 — Activity Implementation and Data Contracts

### Goal
Implement concrete YouTube activities with strict contracts and error taxonomy.

### Steps
1. `classify_resource` activity:
   - validate provider/resource_type
   - extract/canonicalize video id
2. `fetch_transcript` activity:
   - retrieve available transcript track
   - normalize transcript text and language metadata
   - emit structured failure reasons (no_track, blocked, transient_network, parse_error)
3. `persist_transcript_chunks` activity:
   - chunk transcript
   - write `link_transcript_chunks`
4. `generate_transcript_chunk_embeddings` activity:
   - generate/store embedding vectors for transcript chunks
5. `finalize_resource_status` activity:
   - set `transcript_status`, `processing_status`, metadata summary

### Acceptance criteria
- Each activity can fail independently with actionable errors
- Partial failures can resume from the failed stage (no full restart required)

---

## Phase 3 — Chunk Question Generation Parity

### Goal
Add question-generation parity for YouTube transcript chunks similar to document chunk questions.

### Steps
1. Add transcript-question table (or unify with `document_chunk_questions` via generalized schema)
2. Add activity: `generate_transcript_chunk_questions`
   - produce 1-N targeted questions per chunk
3. Add activity: `generate_transcript_question_embeddings`
4. Add metrics fields:
   - question_count
   - embedded_question_count
   - coverage_percent
5. Add query helpers for transcript question stats

### Acceptance criteria
- Transcript chunks have generated questions and embeddings
- Failure in question generation does not destroy transcript chunk availability

---

## Phase 4 — Retrieval Integration Parity

### Goal
Ensure chat retrieval uses YouTube transcript chunks/questions with parity to document retrieval behavior.

### Steps
1. Extend hybrid retrieval to include transcript chunk-question semantic search
2. Add transcript keyword fallback where semantic misses occur
3. Add source balancing to avoid transcript over-dominance
4. Add provenance fields in retrieval result payload:
   - source_kind (`document_chunk`, `transcript_chunk`, `transcript_question`)
   - provider
   - confidence components
5. Tune ranking weights for transcript chunk vs transcript question vs document sources

### Acceptance criteria
- Project/notebook chat can ground answers from transcript chunks and transcript questions
- Retrieval relevance behavior is comparable to document-only flows

---

## Phase 5 — Legacy Queue Path Cleanup

### Goal
Decommission or strictly demote the standalone queue-worker path after workflow migration stabilizes.

### Steps
1. Mark `youtube_transcript_jobs` path as legacy
2. Add compatibility bridge during migration window:
   - in-flight jobs can complete without data loss
3. Switch UI retry to workflow-based retry trigger
4. Remove schedule dependency for legacy worker in primary path
5. Decommission legacy RPCs/functions when safe:
   - `enqueue_youtube_transcript_job`
   - `claim_next_youtube_transcript_job`
   - `complete_youtube_transcript_job`
   - `youtube-transcript-worker` (or keep as fallback feature-flagged)

### Acceptance criteria
- Primary production path is workflow-based end-to-end
- Legacy artifacts removed or feature-flagged with explicit operational runbook

---

## Phase 6 — UX + Observability Updates

### Goal
Expose workflow-native processing insight for YouTube resources in product UI and operations.

### Steps
1. Drawer timeline section for YouTube activity stages
2. Per-stage error display and retry affordance
3. Resource-level diagnostics fields:
   - last_activity_key
   - last_activity_status
   - last_failure_reason
4. Add monitoring/dashboard widgets:
   - workflow queue depth
   - failure rate by activity key
   - median processing duration
5. Add alerting thresholds and SLOs for YouTube processing

### Acceptance criteria
- User can understand where a YouTube resource is stuck
- Ops can diagnose and recover without direct DB for common failures

---

## Phase 7 — Migration Validation and Rollout

### Goal
Safely migrate existing YouTube resources and roll out with minimal disruption.

### Steps
1. Backfill plan for already-ingested YouTube resources:
   - detect missing chunks
   - detect missing transcript questions/embeddings
2. Run staged rollout with feature flag:
   - internal
   - small tenant subset
   - full rollout
3. Add migration verification checks:
   - status parity checks
   - retrieval parity checks
4. Add rollback strategy to legacy pipeline if critical regressions occur
5. Finalize docs/runbook and handoff

### Acceptance criteria
- No data loss across migration
- Retrieval quality does not regress for existing resources
- Rollout and rollback paths are documented and tested

---

## Milestone Checklist

- [ ] Workflow definition for YouTube created and active
- [ ] YouTube processing triggered via workflow-start
- [ ] Transcript chunk question generation implemented
- [ ] Question embeddings implemented for transcript questions
- [ ] Hybrid retrieval includes transcript questions with tuned ranking
- [ ] UI shows workflow-native stage visibility for YouTube resources
- [ ] Legacy queue-worker path removed or fallback-only
- [ ] Migration/backfill completed and verified

---

## Notes

1. Keep schema decisions aligned with long-term multi-adapter design:
   - Prefer generalized "resource chunk/question" primitives over YouTube-specific one-offs where practical.
2. Preserve strict permission model parity with existing document/notebook/project access controls.
3. Any AI-based question generation should remain optional/fallback with deterministic baseline behavior when unavailable.
