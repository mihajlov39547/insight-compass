# Workflow Resilience & Retry Improvements

Tracking the changes proposed after the stuck YouTube transcript investigation
(resource `24d17fe1-aa27-4f42-9858-f19237a65154`, video `vdBvGPUYaSY`).

Check off items as they ship. Keep this file updated in the same PR that lands each change.

---

## Phase 1 — Reset-and-retry (highest priority)

Goal: every "Retry" button (document, video, any resource) wipes prior state
and starts a clean workflow run instead of resuming a half-broken one.

- [x] Create shared backend RPC / edge function `reset_resource_for_retry`
  - [x] For `resource_links` (YouTube): clear `link_transcript_chunks`,
        `link_transcript_chunk_questions`, `transcript_error`,
        `metadata.transcript._text_stash`/`error`/`debug` and `metadata.summary`,
        and reset `transcript_status` to `pending`
  - [x] For `documents`: clear `document_chunks`, `document_chunk_questions`,
        `document_analysis`, reset `processing_status` to `uploaded` and clear
        error/summary/language/counts fields
  - [x] Cancel all active `workflow_runs` for the entity (set `cancelled` with
        reason `superseded_by_retry`) and cancel their non-terminal `activity_runs`
- [x] Wire all retry entry points to call it before `workflow-start`:
  - [x] `useResourceActions` retry path (YouTube + linked resources)
  - [x] Document retry button (`useRetryProcessing` in `useDocuments`)
  - [ ] Any backend auto-retry on failure (if it bypasses the UI) — N/A, all retries go through UI hooks today
- [ ] Add UI confirmation copy: "Retry will clear previous results and re-run from scratch."

## Phase 2 — Sync workflow failures back to the resource

Goal: when a workflow run fails, the resource row reflects it immediately so
the UI never shows perpetual `processing`.

- [x] In `workflow-finalization.ts`, on terminal `failed` workflow:
  - [x] If trigger is `resource_link`: update `transcript_status = 'failed'`,
        `transcript_error = <last activity error>`, `transcript_updated_at = now()`
  - [x] If trigger is `document`: update `processing_status = 'failed'` with reason
        (last failed activity's `error_message`, not just generic reason)
- [ ] Add a DB trigger as defensive backstop: `workflow_runs.status -> failed`
      propagates to the linked entity if not already terminal
      propagates to the linked entity if not already terminal

## Phase 3 — Durable transcript storage

Goal: stop stuffing transcripts into `resource_links.metadata` / context patches.

- [ ] New table `youtube_transcript_stages` (resource_link_id, stage, text, lang, created_at)
  - [ ] RLS mirrors `resource_links`
- [ ] `youtubeFetchTranscript` writes raw transcript here instead of stash
- [ ] `youtubePersistTranscriptChunks` + `youtubeFinalizeResourceStatus`
      read from this table; remove `_text_stash` helpers
- [ ] Migration: backfill not required (drop stash on next reset)

## Phase 4 — Tolerant finalization

Goal: optional branches (question enrichment, question embeddings) must never
block the workflow from completing once chunks + embeddings exist.

- [ ] Audit `youtube_processing_v1` and `document_processing_v1` DAGs:
  - [ ] Confirm `is_optional = true` on enrichment activities
- [ ] Update `workflow-finalization-policy.ts` to ignore optional `failed`
      activities when computing terminal state (already partial — verify)
- [ ] Add unit test in `validation-harness` for "optional fails, workflow completes"

## Phase 5 — Stale-run detection

Goal: if no activity transitions for N minutes, mark the run failed and surface retry.

- [ ] Extend `workflow-maintenance` cron:
  - [ ] Detect workflow_runs with `status in (running, pending)` and no
        `activity_runs.updated_at` change in > 10 min
  - [ ] Mark stale activity_runs as `failed` with reason `stale_lease`
  - [ ] Let finalization roll the workflow to `failed`
- [ ] Add Phase 2 sync so resource flips to `failed` automatically

## Phase 6 — UI: workflow truth in the badge

Goal: resource/document status badge reflects the latest workflow run,
not just the legacy column.

- [ ] `useResourceWorkflowTimeline` already exposes workflowStatus — use it in
      `LinkedVideoRow` / resource detail to override stuck `processing`
- [ ] Show last error message inline with a "Retry" affordance
- [ ] Same treatment for documents in `DocumentStatusBadge`

---

## Verification checklist (run after each phase)

- [ ] Reprocess `vdBvGPUYaSY` end-to-end with a fresh retry — transcript persisted, chunks > 0, embeddings > 0
- [ ] Force a failure (bad video ID) — UI flips to `failed` within seconds, retry recovers
- [ ] Kill a worker mid-activity — stale detection marks it failed within 10 min
- [ ] Optional enrichment failure does not block `completed` state
