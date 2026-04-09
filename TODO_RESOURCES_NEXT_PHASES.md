# Resources Platform — Next Phases Roadmap

## Base Snapshot (Current, Completed)

This roadmap starts from a stable base that is already delivered:

1. Unified Resources surface for uploaded documents and linked resources
2. Permission-aware access model across personal, project, and notebook scopes
3. Link enrichment baseline (normalized URL, provider detection, preview metadata)
4. YouTube adapter baseline with async transcript ingestion lifecycle
5. Transcript persistence in dedicated retrieval path (`link_transcript_chunks`)
6. Transcript preview/query in drawer and transcript-aware hybrid retrieval
7. Worker hardening (service-role RPCs, lease checks, worker identity checks)

---

## Target End State

A production-complete Resources platform that supports:

1. Multi-provider adapters (Drive, Dropbox, Notion, additional media)
2. Reliable ingestion + retries + observability + backfills
3. Rich retrieval (semantic + keyword + source-aware ranking)
4. Full UX for resource exploration, provenance, and operations
5. Stable operations model (scheduling, secrets, environment portability)

---

## Phase 3 — Adapter Framework Generalization

### Goal
Generalize from a YouTube-specific flow to a provider-agnostic adapter framework.

### Step-by-step plan
1. Define canonical adapter contract:
   - identify_resource
   - fetch_metadata
   - fetch_content
   - optional_fetch_questions
2. Add adapter registry table/config for provider -> adapter mapping
3. Split current link enrichment function into adapter orchestration + provider implementations
4. Add common ingestion state machine for all adapters
5. Add idempotency key strategy for repeated ingest calls

### Acceptance criteria
- Any provider can be added by implementing contract functions only
- Existing YouTube flow runs unchanged through new framework

---

## Phase 4 — Source Adapters Expansion (Drive/Dropbox/Notion)

### Goal
Support first non-YouTube external adapters with metadata and content ingestion.

### Step-by-step plan
1. Google Drive adapter:
   - file metadata ingestion
   - permission-aware link mapping
   - content extraction for supported mime types
2. Dropbox adapter:
   - metadata ingestion and content fetch
3. Notion adapter:
   - page metadata
   - block text extraction and normalization
4. Add provider-specific retry/error classification
5. Add source connection lifecycle states (connected/syncing/error/revoked)

### Acceptance criteria
- All three providers ingest at least metadata + searchable text
- Resources list/drawer show provider-specific fields cleanly

---

## Phase 5 — Media Pipeline Completion

### Goal
Expand beyond YouTube baseline to robust media support.

### Step-by-step plan
1. YouTube improvements:
   - richer metadata (duration, channel id, publish time)
   - transcript language selection
   - transcript refresh on content/version change
2. Generic video adapters:
   - Vimeo and direct hosted video URL support (metadata-first)
3. Audio ingestion:
   - upload/link audio resources
   - ASR transcript pipeline (queued/running/ready/failed)
4. Add media-specific chunk strategy and confidence scoring

### Acceptance criteria
- Audio/video transcript retrieval quality comparable to document retrieval baseline

---

## Phase 6 — Retrieval and Relevance Quality

### Goal
Improve grounding quality and retrieval consistency across documents + transcripts + links.

### Step-by-step plan
1. Add retrieval source balancing to avoid over-dominance of one source class
2. Introduce source-aware weighting controls (document/transcript/link)
3. Add transcript snippet keyword fallback in hybrid retrieval
4. Add per-result provenance payload (source_type, provider, confidence)
5. Evaluate and tune similarity thresholds by provider/type

### Acceptance criteria
- Mixed-source queries return balanced, explainable results
- Retrieval behavior is stable across project/notebook/global scopes

---

## Phase 7 — UX Completion for Resources

### Goal
Complete resources UI for operational readiness.

### Step-by-step plan
1. Grid/card view toggle with persistent user preference
2. Bulk actions (delete, retag, retry)
3. Enhanced drawer:
   - processing timeline
   - adapter diagnostics
   - transcript/download/open original controls
4. Filter system expansion:
   - provider
   - source type
   - readiness + error state
5. In-product admin diagnostics surface for failed ingestions

### Acceptance criteria
- Power-user workflows can be completed without direct DB tooling

---

## Phase 8 — Operations, Security, and Environment Portability

### Goal
Production-safe operations across environments.

### Step-by-step plan
1. Replace migration-time schedule assumptions with deploy-time schedule management script
2. Secret rotation plan for worker invocation secret
3. Dead-letter handling for transcript and adapter jobs
4. Backfill jobs for legacy resources lacking chunks/embeddings
5. Dashboards + alerts:
   - job queue depth
   - failure rate
   - median ingestion time
6. Runbook and rollback procedures per adapter

### Acceptance criteria
- New environment bootstrap does not require manual SQL edits
- Worker pipelines are observable and recoverable under failure

---

## Phase 9 — Release Readiness

### Goal
Formalize release gates for Resources platform GA.

### Step-by-step plan
1. End-to-end tests for each provider and scope model
2. Load test transcript and retrieval paths
3. Security review for RLS + SECURITY DEFINER + worker endpoints
4. Product QA checklist and migration dry runs in staging
5. Release toggle strategy and staged rollout

### Acceptance criteria
- All release gates pass
- Rollback and forward-fix playbooks verified

---

## Execution Order Recommendation

1. Phase 3 first (framework)
2. Phase 4 and 5 in parallel after framework stabilizes
3. Phase 6 and 7 once provider coverage is stable
4. Phase 8 and 9 before broad rollout

---

## Current Wrap Point

At this point, the system is a strong implementation baseline for:

1. Uploaded documents (full processing path)
2. Linked resources with enrichment baseline
3. YouTube links with async transcript ingestion and retrieval path

This roadmap captures the work needed to move from strong baseline to production-complete multi-adapter Resources platform.
