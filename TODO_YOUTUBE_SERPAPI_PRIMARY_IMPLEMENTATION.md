# YouTube Transcript via SerpApi — Primary Provider Implementation TODO

## Goal

Make SerpApi the primary transcript source for YouTube resources, while keeping current internal scraping strategies as controlled fallback paths.

This plan assumes `SERPAPI_KEY` is already configured in Supabase Edge Function secrets.

---

## Current Baseline (Verified)

1. Transcript ingestion runs through `youtube-transcript-worker`.
2. Transcript acquisition currently relies on internal YouTube scraping/InnerTube strategies.
3. Worker already persists transcript debug metadata to `resource_links.metadata.transcript.debug`.
4. UI Transcript tab can render debug diagnostics from metadata.

Implication: no schema rewrite is required to introduce SerpApi as primary source.

---

## Provider Strategy (Target)

Provider order for `fetchTranscriptForVideo`:

1. **Primary:** SerpApi `engine=youtube_video_transcript`
2. **Fallback A:** legacy timedtext endpoint
3. **Fallback B:** page caption tracks
4. **Fallback C:** page-extracted InnerTube key
5. **Fallback D:** env-key InnerTube

Behavior policy:

1. If SerpApi returns valid transcript snippets, accept result and stop.
2. If SerpApi fails or returns empty transcript, continue fallback chain.
3. Always emit debug payload indicating provider attempted, status, and failure reason.

---

## Implementation Tasks

## Phase 1 — Add SerpApi Fetch Path

### Files
1. `supabase/functions/youtube-transcript-worker/transcript-fetcher.ts`

### Tasks
1. Add `trySerpApiTranscript(videoId, options)` strategy.
2. Read key via `Deno.env.get("SERPAPI_KEY")`.
3. Build request to:
   - `https://serpapi.com/search.json`
   - query params: `engine=youtube_video_transcript`, `v=<videoId>`, `api_key=<SERPAPI_KEY>`
4. Optional params support:
   - `language_code` (default `en` unless explicit override)
   - `type=asr` optional tuning knob
   - `no_cache=true|false` configurable (default `false`)
5. Parse transcript from `transcript[]` array by joining `snippet` fields in time order.
6. Normalize text similarly to existing flow:
   - trim snippets
   - preserve line breaks between snippets
   - reject empty final text
7. Return `StrategyResult` with:
   - `strategy: "serpapi_youtube_video_transcript"`
   - language from `search_parameters.language_code` when present
   - `trackCount` derived from snippet count
   - `meta` containing `provider=serpapi` and `search_id` when available

### Debug payload additions
1. Record stage `serpapi_primary` with:
   - `status` success/failed/skipped
   - `reason`
   - `httpStatus`
   - `trackCount`
2. Add top-level debug fields:
   - `serpapiAttempted: boolean`
   - `serpapiSearchId: string | null`
   - `serpapiLanguageCode: string | null`
   - `serpapiError: string | null`

---

## Phase 2 — Wire Primary-First Orchestration

### Files
1. `supabase/functions/youtube-transcript-worker/transcript-fetcher.ts`

### Tasks
1. Run SerpApi strategy before all existing scraping strategies.
2. Update failure stage summary ordering to include `serpapi_primary` first.
3. Ensure exception still includes concise stage chain in error text.
4. Keep existing fallbacks unchanged to avoid regression risk.

---

## Phase 3 — Worker Persistence and Safety

### Files
1. `supabase/functions/youtube-transcript-worker/index.ts`

### Tasks
1. Confirm debug persistence helper continues merging metadata after completion RPC.
2. Add explicit provider marker on success:
   - `metadata.transcript.provider = "serpapi" | "internal_fallback"`
3. On failure, persist:
   - provider attempted
   - last provider error
4. Do not overwrite existing non-transcript metadata keys.

---

## Phase 4 — UI Debug Visibility Enhancements

### Files
1. `src/hooks/useResourceTranscriptDebug.ts`
2. `src/components/views/ResourcesLanding.tsx`

### Tasks
1. Extend `TranscriptDebugPayload` TS type to include SerpApi fields.
2. In Transcript debug section, show:
   - SerpApi attempted: yes/no
   - SerpApi search ID
   - SerpApi language code
   - SerpApi error message
3. Keep existing key masking behavior for env secrets.
4. Do not expose `SERPAPI_KEY` in UI or logs.

---

## Phase 5 — Config, Rollout, and Ops

### Files
1. `docs/youtube-transcript-worker-setup.md`

### Tasks
1. Document required secret:
   - `SERPAPI_KEY`
2. Add operational knobs (optional env vars):
   - `YT_TRANSCRIPT_PROVIDER_PRIMARY=serpapi`
   - `YT_TRANSCRIPT_SERPAPI_NO_CACHE=false`
   - `YT_TRANSCRIPT_FALLBACK_ENABLED=true`
3. Add runbook entry for SerpApi outages:
   - fallback behavior
   - alert thresholds

---

## Error Taxonomy Mapping

Map SerpApi response conditions into stable reasons:

1. `serpapi_missing_key`
2. `serpapi_http_error_<status>`
3. `serpapi_processing_error`
4. `serpapi_no_transcript`
5. `serpapi_parse_error`
6. `serpapi_timeout`

These should be reflected in debug `reason` and summarized error text when all strategies fail.

---

## Testing Plan

## Unit/Logic tests
1. Parse sample SerpApi payload into transcript text.
2. Empty transcript array falls back correctly.
3. SerpApi HTTP error falls back correctly.
4. Debug payload contains `serpapi_primary` stage and fields.

## Integration tests
1. Known captioned video succeeds via SerpApi.
2. Video without captions fails SerpApi then fallback chain, with debug shown.
3. Retry transcript updates debug payload on next attempt.

## UI checks
1. Transcript tab shows SerpApi diagnostics in failed state.
2. Transcript tab shows provider info in ready state.
3. No secrets displayed.

---

## Deployment Steps

1. Deploy updated edge function:
   - `supabase functions deploy youtube-transcript-worker`
2. Confirm secrets present:
   - `SERPAPI_KEY`
3. Trigger retry on one failed YouTube resource.
4. Verify in UI Transcript tab:
   - debug shows SerpApi stage
   - success path reports provider `serpapi` when used

---

## Acceptance Criteria

1. SerpApi is the first strategy attempted for YouTube transcript fetch.
2. Successful SerpApi responses produce transcript chunks and embeddings as today.
3. If SerpApi fails, fallback chain still works.
4. Transcript tab shows clear SerpApi debug information on failure.
5. No sensitive keys are exposed in logs or UI.

---

## Post-Launch Metrics

1. Success rate by provider (`serpapi` vs fallback).
2. Median and P95 transcript fetch latency.
3. Fallback rate (how often SerpApi misses and fallback is needed).
4. Failure reason distribution (taxonomy above).
5. Cost tracking (SerpApi calls/day and cache-hit behavior).
