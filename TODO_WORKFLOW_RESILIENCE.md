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

- [x] New table `youtube_transcript_stages` (resource_link_id, stage, text, lang, created_at)
  - [x] RLS mirrors `resource_links` (viewer access via owner/project/notebook; service role writes)
- [x] `youtubeFetchTranscript` writes raw transcript here instead of stash
- [x] `youtubePersistTranscriptChunks` + `youtubeFinalizeResourceStatus`
      read from this table; legacy `_text_stash` retained as fallback for in-flight runs
- [x] `reset_resource_for_retry` wipes stages on retry; backfill not required (drop stash on next reset)

## Phase 4 — Tolerant finalization ✅

Goal: optional branches (question enrichment, question embeddings) must never
block the workflow from completing once chunks + embeddings exist — AND the
finalize step must never lie about readiness when the essential outputs are
missing.

- [x] Audited DAGs (`workflow_activities` snapshot):
      youtube `generate_transcript_chunk_questions` +
      `generate_transcript_question_embeddings` and document
      `document.generate_chunk_questions` are `is_optional = true`; all
      transcript / chunk / embedding / finalize steps are required.
- [x] Verified `workflow-finalization.ts` already ignores optional
      `failed`/`cancelled` activities (`!row.is_optional` filter) — optional
      failures contribute only to `optional_failure_count` and do not flip
      the workflow to `failed`.
- [x] Added strict readiness gate to `youtubeFinalizeResourceStatus`: counts
      actual rows in `link_transcript_chunks` (and embedded rows). Sets
      `transcript_status = 'ready'` only when both `chunk_count > 0` and at
      least one embedding exists; otherwise sets
      `transcript_status = 'failed'` with an explicit `transcript_error` and
      returns a non-retryable handler failure (`READINESS_GATE_FAILED`) so
      the workflow ends `failed` and Phase 2 sync propagates the truth.
- [x] Mirrored the strict gate in `finalizeDocumentStage`: counts
      `document_chunks` and embedded rows for the document; if either is 0
      the stage flips `documents.processing_status = 'failed'` with an
      explicit reason and throws a terminal `READINESS_GATE_FAILED` so the
      workflow ends `failed` and Phase 2 sync propagates the truth.
- [ ] Add unit test in `validation-harness` for "optional fails, workflow
      completes" and "required chunk persistence yields 0 rows → finalize
      fails".

## Phase 5 — Stale-run detection

Goal: if no activity transitions for N minutes, mark the run failed and surface retry.

- [ ] Extend `workflow-maintenance` cron:
  - [ ] Detect workflow_runs with `status in (running, pending)` and no
        `activity_runs.updated_at` change in > 10 min
  - [ ] Mark stale activity_runs as `failed` with reason `stale_lease`
  - [ ] Let finalization roll the workflow to `failed`
- [ ] Add Phase 2 sync so resource flips to `failed` automatically

## Phase 6 — Resume from failed activity (partial retry)

Goal: in addition to the full reset retry, expose a "Resume" action that
re-runs ONLY the failed activities of the current workflow run and lets
downstream activities continue once they succeed. Successful upstream
activities (and their outputs in workflow context) MUST be preserved.

Key principle: full retry = wipe + new workflow_run. Partial resume =
re-arm failed activity_runs on the SAME workflow_run, keeping prior
context patches and completed activity outputs intact.

- [x] Added `workflow_runs.resume_count` (int) and `resumed_at` (timestamptz).
- [x] Backend RPC `resume_failed_activities(workflow_run_id)` (SECURITY
      DEFINER, validates `auth.uid() = workflow_runs.user_id`):
      resets failed/dead_letter required activity_runs to `queued`,
      clears error/lease/claim/attempt state, scheduled_at=now(),
      flips workflow_runs back to `running`, increments resume_count,
      logs a `workflow_resumed` event, and caps resumes at 5 per run.
- [x] Frontend hook `useResumeFailedActivities` calls the RPC and fires
      the same staggered worker kicks `useDocuments` uses for fresh starts
      (no separate edge function needed — RPC + worker kick is enough).
- [x] WorkflowDiagram surfaces a "Resume failed step(s)" banner with a
      destructive button whenever the run has failed activities and is not
      already `completed`. Wired through the resource drawer Workflow tab.
- [ ] Context sufficiency audit per handler — make sure a failed activity
      can re-run standalone from `workflow_runs.context` + its
      `input_payload` without depending on volatile in-memory state from
      its upstream activity:
  - [x] `youtubeFetchTranscript` — reads resource row; OK
  - [x] `youtubePersistTranscriptChunks` — reads `youtube_transcript_stages`; OK
  - [ ] `youtubeFinalizeResourceStatus` — verify it reads stages, not stash
  - [ ] Document handlers (`extract_pdf_text`, `ocr_pdf`,
        `normalize_output`, `chunk_text`, etc.) — verify each reads from
        durable storage (storage bucket + `document_analysis`), not
        transient context
- [ ] Also render the Resume button on the document/video row inline
      (`LinkedVideoRow`, `DocumentStatusBadge`) so users don't have to
      open the drawer.
- [ ] Verification: induce a transient failure in the
      `persist_transcript_chunks` activity, fix the root cause, click
      Resume → chunks land, embeddings + finalize run, workflow ends
      `completed` on the SAME workflow_run_id.

## Phase 7 — UI: workflow truth in the badge

Goal: resource/document status badge reflects the latest workflow run,
not just the legacy column.

- [ ] `useResourceWorkflowTimeline` already exposes workflowStatus — use it in
      `LinkedVideoRow` / resource detail to override stuck `processing`
- [ ] Show last error message inline with a "Retry" affordance
- [ ] Same treatment for documents in `DocumentStatusBadge`

---

## Phase 8 — Gate "Ready" on transcript for video resources

Goal: a YouTube/video resource must NOT be reported as Ready while the
transcript is still missing — the transcript is the only searchable/chat
content, so `metadata_ready` alone is misleading.

- [x] `deriveReadiness()` now takes `{ resourceType, transcriptStatus }` and,
      for `video` / `link_video`, returns `ready` only when
      `transcript_status === 'ready'`, `failed` when transcript failed, and
      `processing` otherwise — regardless of `processing_status`.
- [x] `mapRpcRowToResource()` passes the new context.
- [ ] Audit backend RPC `get_user_resources` to ensure it does not itself
      collapse `processing_status` into a "ready"-implying field that bypasses
      `deriveReadiness` (it returns raw `processing_status` + `transcript_status`,
      so the frontend gate is sufficient today, but worth a one-time check).
- [ ] Verification: link a video → row stays "Processing" until transcript
      lands, then flips to "Ready"; if transcript fails, row shows "Failed"
      with retry available even though metadata was extracted successfully.

---

## Verification checklist (run after each phase)

- [ ] Reprocess `vdBvGPUYaSY` end-to-end with a fresh retry — transcript persisted, chunks > 0, embeddings > 0
- [ ] Force a failure (bad video ID) — UI flips to `failed` within seconds, retry recovers
- [ ] Kill a worker mid-activity — stale detection marks it failed within 10 min
- [ ] Optional enrichment failure does not block `completed` state
- [ ] Resume from failed activity: single activity fails → fix → Resume reruns only that step and downstream completes on same workflow_run

---

## Phase 9 — Resource drawer: Workflow diagram tab

Goal: give users a visual representation of the active workflow DAG
(youtube_processing_v1 / document_processing_v1) with live per-activity
status, so they can see at a glance where a run is and which step failed.

- [x] New SECURITY DEFINER RPC `get_workflow_dag(p_workflow_run_id uuid)`
      returns `{ workflow_key, workflow_status, nodes[], edges[] }` for the
      version pinned to the run, joined against `activity_runs` for live
      status / attempt_count / error_message. Caller must be `auth.uid()`
      = `workflow_runs.user_id`.
- [x] Hook `useWorkflowDagForResource(resourceId)` fetches the latest
      workflow_run for the resource and calls the RPC; polls every 5 s
      while the drawer is open.
- [x] `WorkflowDiagram` component performs a longest-path layered layout
      (depth = longest path from entry), renders nodes as status-colored
      boxes with icons (pending / running / completed / failed / skipped)
      and SVG bezier edges with arrowheads.
- [x] Resource drawer (`ResourcesLanding` ResourceDetailsSheet) now has a
      third subtab "Workflow" (shown for video + document resources),
      next to Overview and Transcript/Extracted text.
- [x] Compact top-down layout + auto-scroll to first failed node + red ring
      highlight so failures stay visible inside the narrow drawer (tested
      with d1.pdf workflow that surfaces 30 activities).
- [ ] Add click → "Resume failed step" affordance directly on the failed
      node (ties into Phase 6).
- [ ] Render the same diagram inside the document/video row inline timeline
      as an opt-in expansion, replacing the linear activity list when the
      DAG has parallel branches.

---

## Phase 10 — Scanned-PDF must route to `document.ocr_pdf`

Goal: today the active `document_processing_v1` DAG unconditionally goes
`inspect_pdf_text_layer → persist_metadata.after_pdf_inspection → extract_pdf_text → normalize_output`.
For scanned PDFs `extract_pdf_text` returns empty (`pdf_text_status =
NATIVE_EXTRACTION_EMPTY`, extractor `unpdf_empty`), and `normalize_output`
fails with "Normalized extraction output is empty". The handler for
`document.ocr_pdf` exists and is registered, but no edge routes to it.

Reproduced with workflow run `3a07d8fe-4553-46be-b716-623432144129`
(d1.pdf): inspection completed, extract completed empty, normalize failed,
ocr_pdf stayed `pending` forever.

Fix:
- [x] Data migration on active version `dc2930ab` (`document_processing_v1` v4):
      tightened edge `after_pdf_inspection → extract_pdf_text` to fire only
      when `pdf_text_status IN ('INSPECTION_HAS_TEXT_LAYER','HAS_SELECTABLE_TEXT')`.
- [x] Added edge `after_pdf_inspection → ocr_pdf` conditional on
      `pdf_text_status IN ('LIKELY_SCANNED','INSPECTION_NO_TEXT_LAYER','INSPECTION_FAILED','NATIVE_EXTRACTION_EMPTY')`.
- [x] Edge `ocr_pdf → normalize_output` already exists on v4 (verified).
- [ ] Bake the same routing into the workflow-definition seed/migration so a
      future version bump (v5+) keeps it.
- [ ] Handler: have `document.extract_pdf_text` set `pdf_text_status =
      NATIVE_EXTRACTION_EMPTY` in its context patch when output is empty,
      enabling a future belt-and-braces `extract_pdf_text → ocr_pdf`
      rescue edge.
- [ ] Verification: re-upload d1.pdf (or hit Retry) — inspection reports
      LIKELY_SCANNED, run skips `extract_pdf_text`, runs `ocr_pdf`,
      normalize succeeds, document reaches `completed` with OCR text.
