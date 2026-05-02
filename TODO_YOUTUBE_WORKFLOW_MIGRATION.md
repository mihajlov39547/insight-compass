# YouTube Processing Workflow Migration — COMPLETED ✅

> **Status:** All phases complete. Migration finished 2026-05-02.

---

## Summary

YouTube transcript processing has been fully migrated from the legacy `youtube_transcript_jobs` queue + standalone `youtube-transcript-worker` edge function to the workflow engine (`youtube_processing_v1` definition, handled by `workflow-worker`).

### What was done

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Workflow definition + flagged trigger | ✅ |
| 2 | Activity handlers (7 steps) ported from legacy worker | ✅ |
| 3 | Retrieval parity verified (chunks, embeddings, questions) | ✅ |
| 4 | Workflow-native UI timeline + retry affordance | ✅ |
| 5 | Cutover — flag flipped, workflow-first retry | ✅ |
| 6 | Legacy decommission | ✅ |

### Phase 6 — Legacy Decommission (completed 2026-05-02)

- [x] **6.1** Moved shared modules (`transcript-fetcher.ts`, `chunk-persistence.ts`) to `_shared/youtube/`; updated workflow handler imports.
- [x] **6.2** Removed cron schedule `youtube-transcript-worker-minute` from `cron.job`.
- [x] **6.3** Deleted `supabase/functions/youtube-transcript-worker/` directory and removed config from `supabase/config.toml`. Deleted deployed edge function.
- [x] **6.4** Dropped `youtube_transcript_jobs` table and `extract_youtube_video_id` function.
- [x] **6.5** Removed legacy fallback from `useRetryYouTubeTranscriptIngestion` — retry is now workflow-only.

### Architecture (final state)

```
User adds YouTube link
  → useCreateLinkResource → POST /workflow-start (youtube_processing_v1)
  → workflow-worker processes 7 activities:
     classify_resource → fetch_transcript → persist_transcript_chunks →
     generate_transcript_chunk_embeddings → generate_transcript_chunk_questions →
     generate_transcript_question_embeddings → finalize_resource_status
  → UI shows workflow-native timeline via useResourceWorkflowTimeline
```

Shared modules live in `supabase/functions/_shared/youtube/` and are imported by `workflow-worker/handlers/youtube.ts`.
