# YouTube Transcript — Remaining TODO

This file is the single source of truth for pending YouTube transcript work.

## Status Snapshot (2026-04-15)

Completed already:
1. SerpApi is primary transcript provider.
2. Debug payload and Transcript debug UI are implemented.
3. Monolith transcript post-processing is implemented:
   - chunking
   - chunk embeddings
   - chunk question generation
   - question embeddings
4. Full transcript text is shown in Transcript tab.
5. Metadata enrichment is implemented (title + subtitle/channel best effort).
6. Transcript question semantic retrieval path is implemented in hybrid retrieval.
7. Transcript summary generation is implemented in worker using the same AI summarization helper pattern as documents.
8. Resources summary field now prefers `metadata.transcript.summary` for YouTube linked resources.

## Remaining Tasks

## 1) Docs, Ops, and Runbook (Phase 5)
1. Update worker setup doc with required and optional env vars:
   - SERPAPI_KEY (required)
   - YT_TRANSCRIPT_SERPAPI_LANGUAGE_CODE (optional)
   - YT_TRANSCRIPT_SERPAPI_TYPE (optional)
   - YT_TRANSCRIPT_SERPAPI_NO_CACHE (optional)
2. Add operational runbook:
   - how to diagnose serpapi_* failures
   - how to distinguish provider outage vs no transcript
   - how to verify title/subtitle enrichment
3. Add deployment checklist for this pipeline:
   - migration application
   - edge function deploys
   - post-deploy smoke tests

## 2) Deploy and Validate in Environment
1. Apply DB migration:
   - supabase/migrations/20260415113000_transcript_chunk_questions.sql
2. Redeploy edge functions:
   - youtube-transcript-worker
   - hybrid-retrieval
3. Run smoke tests:
   - successful transcript ingestion
   - failed transcript ingestion
   - debug payload visibility
   - transcript question rows and embeddings created

## 3) Title/Subtitle Reliability Hardening
1. Verify exact title/channel are updated in list + details for newly processed resources.
2. Add one-time backfill script for older YouTube resources with generic title/channel values.
3. Add guardrails to avoid overwriting a user-renamed custom title unless explicit policy says otherwise.

## 4) Retrieval Verification and Tuning
1. Validate that transcript question hits are actually contributing to chat grounding quality.
2. Tune ranking weights for transcript chunks vs transcript questions if needed.
3. Add targeted diagnostics in hybrid retrieval logs for transcript-question hit rates.

## 5) Code Cleanup and Maintenance
1. Remove dead/unused legacy transcript-fetch functions from transcript-fetcher.ts if they are no longer executed.
2. Keep non-blocking metadata probe paths only if they provide measurable value.
3. Add concise comments around the active execution path to reduce future drift.

## 6) Monolith to Workflow Migration (Future)
1. Keep current monolith path as active for now.
2. Plan workflow-engine migration as a separate phase after stabilization:
   - fetch transcript
   - persist chunks
   - generate chunk embeddings
   - generate chunk questions
   - generate question embeddings
3. Preserve current debug schema compatibility during migration.

## Acceptance for This Remaining TODO
1. Pipeline is documented and operationally supportable.
2. Deploy + smoke test process is repeatable.
3. Title/subtitle accuracy is reliable for new and backfilled resources.
4. Retrieval benefit from transcript questions is verified in practice.
5. Technical debt from old fetch path is cleaned up safely.
