# Resources Dashboard — Implementation Status

## Phase 1 — ✅ COMPLETED

### Deliverables

1. **Backend RPC** — `get_user_resources()` SQL function (SECURITY DEFINER)
   - Returns all documents accessible to the current user
   - Permission-aware via `check_item_permission()`
   - Joins profiles for owner names, projects/notebooks for container names
   - Classifies resource type from file_type (document/image/spreadsheet/presentation/email/text/dataset/other)
   - Returns unified shape: id, resource_kind, resource_type, source_type, provider, title, mime_type, extension, size_bytes, owner info, container info, is_shared, processing_status, etc.

2. **Resource classification utilities** — `src/lib/resourceClassification.ts`
   - ResourceType, SourceType, ContainerType, SourceProvider type definitions
   - Label maps and icon mappings for all types
   - `deriveReadiness()` — maps processing_status to ready/processing/failed/unknown
   - `mapRpcRowToResource()` — transforms RPC rows into typed Resource objects
   - `formatFileSize()`, `truncateFileName()` helpers
   - Extensible: future resource types (audio, video, link) already defined in types

3. **useResources hook** — `src/hooks/useResources.ts`
   - Calls `get_user_resources` RPC
   - Auto-polls every 5s when any resource is processing
   - Returns typed Resource[] array

4. **Resources dashboard page** — `src/components/views/ResourcesLanding.tsx`
   - Header with summary stats (total, ready, processing, failed, mine, shared)
   - Search across name, container, owner, extension
   - Filters: ownership (all/mine/shared), status (ready/processing/failed), type (dynamic from data), location (project/notebook/personal)
   - Sort: newest, oldest, name, type, status
   - Table view with columns: resource info, type badge, location, status badge, relative time, actions menu
   - Actions: view in project/notebook, retry processing, delete
   - Empty states for no resources and no filter matches
   - Clear filters button

5. **Permission-aware behavior**
   - RPC only returns resources the user can access (owned + shared via RBAC)
   - Shared resources show uploader attribution
   - Delete/retry actions available per resource

### Files created/modified
- `supabase/migrations/` — new migration for `get_user_resources` RPC
- `src/lib/resourceClassification.ts` — NEW
- `src/hooks/useResources.ts` — NEW
- `src/components/views/ResourcesLanding.tsx` — REWRITTEN

### Acceptance criteria met
- [x] Resources page exists and is usable
- [x] User can see all current accessible resources in one place
- [x] Shared collaborator-uploaded resources appear when permitted
- [x] Resources are clearly labeled by type/source/container/status
- [x] Filters/search/sort work
- [x] UI is not document-only in structure (types include image, spreadsheet, etc.)
- [x] Backend projection is future-ready (resource_kind, source_type, provider fields)
- [x] Permissions match existing access model (reuses check_item_permission)
- [x] Page works for both personal and shared Project/Notebook resources

---

## Phase 1.5 — ✅ COMPLETED (Hardening Pass)

### Deliverables
1. **Timestamp correctness**
   - Added `documents.updated_at` with trigger-managed updates
   - Resources sorting and relative timestamps now use `updated_at`

2. **Permission-aware action contract in RPC**
   - Added action flags in `get_user_resources()`:
     - `can_open`, `can_view_details`, `can_download`, `can_rename`, `can_delete`, `can_retry`
   - Added ownership semantics:
     - `is_owned_by_me`, `is_shared_with_me`
     - `is_shared` kept as compatibility alias

3. **Resource-action payload correctness**
   - Removed UI dependence on fabricated `DbDocument` payloads for Resources actions
   - Added dedicated resource action handler hook (`useResourceActions`) for delete/retry/download
4. **SECURITY DEFINER hardening**
   - Locked function execution with `REVOKE ALL ... FROM PUBLIC` and `GRANT EXECUTE ... TO authenticated`
   - Explicit `search_path` and auth guard in hardened RPC

5. **Classification drift prevention**
   - Frontend now treats backend classification as canonical and only validates unknown values

### Files created/modified
- `supabase/migrations/20260408233000_documents_updated_at_column.sql` — NEW
- `supabase/migrations/20260408233500_harden_get_user_resources.sql` — NEW
- `src/hooks/useResourceActions.ts` — NEW
- `src/components/views/ResourcesLanding.tsx` — UPDATED
- `src/lib/resourceClassification.ts` — UPDATED
- `src/hooks/useDocuments.ts` — UPDATED
- `src/integrations/supabase/types.ts` — UPDATED

### Validation
- [x] Build passes
- [x] Lint passes
- [x] Existing tests pass

---

## Phase 2 — 🟡 IN PROGRESS

### Pass 1 — ✅ COMPLETED

#### Delivered in this pass
- Details drawer UI and state management added to Resources page
- Row "View details" action now opens the drawer
- Drawer includes full metadata and processing blocks
- Drawer includes explicit permission blocks (`can_open`, `can_view_details`, `can_download`, `can_rename`, `can_delete`, `can_retry`)
- Personal-resource open fallback added from drawer:
   - If resource has no workspace container, drawer offers "View in personal resources" and applies personal focus filters

#### Files updated in this pass
- `src/components/views/ResourcesLanding.tsx` — UPDATED (details drawer, metadata, permissions, drawer actions)

### Pass 2 — ✅ COMPLETED

#### Delivered in this pass
- Rename action implemented end-to-end from both row menu and details drawer
- Added backend rename mutation path (`rename_user_resource`) with permission checks aligned to `can_rename`
- Added optimistic rename update for resources list and drawer title
- Added rollback on mutation error and resource query invalidation on success

#### Files created/updated in this pass
- `supabase/migrations/20260408235500_rename_user_resource.sql` — NEW
- `src/hooks/useResourceActions.ts` — UPDATED (`useRenameResource`)
- `src/components/views/ResourcesLanding.tsx` — UPDATED (rename dialog + row/drawer wiring)
- `src/integrations/supabase/types.ts` — UPDATED (`rename_user_resource` RPC type)

### Pass 3 — ✅ COMPLETED

#### Delivered in this pass
- Added **Add link** and **Connect source** entry points in Resources header
- Added Add Link dialog with provider + location targeting (personal/project/notebook)
- Added Connect Source dialog that records source connection requests
- Added backend stubs:
   - `create_link_resource_stub(...)`
   - `create_source_connection_request_stub(...)`
- Added stub storage tables for future integrations:
   - `resource_links`
   - `source_connection_requests`
- Extended `get_user_resources()` to include linked stub resources via `UNION ALL`
- Updated rename path compatibility so rename works for both documents and linked resources

#### Files created/updated in this pass
- `supabase/migrations/20260409000500_link_and_source_stubs.sql` — NEW
- `src/components/views/ResourcesLanding.tsx` — UPDATED (entry points + dialogs)
- `src/hooks/useResourceActions.ts` — UPDATED (`useCreateLinkResource`, `useCreateSourceConnectionRequest`)
- `src/integrations/supabase/types.ts` — UPDATED (new RPC type signatures)

### Pass 4 — ✅ COMPLETED

#### Delivered in this pass
- Added server-side URL normalization baseline for linked resources
- Added provider auto-detection from URL domain:
   - `youtube`, `google_drive`, `dropbox`, `notion`, fallback `unknown`
- Added preview metadata extraction baseline for links:
   - `preview_title`, `preview_domain`, `preview_favicon_url`, `normalized_url`
- Extended `get_user_resources()` to return enriched link preview fields
- Surfaced linked-resource enrichment directly in UI:
   - List rows: source/provider chips + preview domain/favicon
   - Details drawer: URL, normalized URL, preview title/domain/favicon

#### Files created/updated in this pass
- `supabase/migrations/20260409004000_link_enrichment_baseline.sql` — NEW
- `src/lib/resourceClassification.ts` — UPDATED (preview fields in model)
- `src/integrations/supabase/types.ts` — UPDATED (enriched RPC return typing)
- `src/components/views/ResourcesLanding.tsx` — UPDATED (list/drawer enrichment UI)

### Pass 5 — ✅ COMPLETED

#### Delivered in this pass
- Added first adapter-driven ingestion lifecycle for linked media
- Implemented YouTube URL adapter baseline:
   - URL normalization and YouTube video ID extraction
   - Provider detection and adapter routing
   - Video metadata baseline fields (`media_video_id`, `media_thumbnail_url`, channel placeholder)
   - Transcript-ready stub output (`transcript_status = ready`)
- Replaced stub-only link enrichment flow with adapter lifecycle progression:
   - `linked` -> `metadata_ready` -> `transcript_ready` (YouTube)
- Extended `get_user_resources()` to expose media metadata and transcript fields
- Surfaced media/link adapter fields directly in Resources list and details drawer

#### Files created/updated in this pass
- `supabase/migrations/20260409013000_youtube_adapter_baseline.sql` — NEW
- `src/lib/resourceClassification.ts` — UPDATED (media + transcript fields; readiness mapping for new statuses)
- `src/integrations/supabase/types.ts` — UPDATED (RPC return type includes media/transcript fields)
- `src/components/views/ResourcesLanding.tsx` — UPDATED (media chips/preview/transcript in list and drawer)

### Pass 6 — ✅ COMPLETED

#### Delivered in this pass
- Replaced transcript-ready stub with real async transcript ingestion flow
- Added YouTube transcript job queue and lifecycle RPCs:
   - `enqueue_youtube_transcript_job(...)`
   - `claim_next_youtube_transcript_job(...)`
   - `complete_youtube_transcript_job(...)`
- Added transcript status progression for linked media:
   - `queued` -> `running` -> `ready` / `failed`
- Added transcript worker edge function:
   - `supabase/functions/youtube-transcript-worker`
   - Claims queued jobs, fetches YouTube transcript tracks, completes jobs with success/failure
- Integrated ingestion trigger points:
   - New YouTube links enqueue transcript jobs automatically
   - Frontend triggers worker best-effort after enqueue/create
- Drawer now shows transcript availability/errors and supports retry action for failed transcript ingestion
- Worker security hardening completed:
   - `claim_next_youtube_transcript_job` and `complete_youtube_transcript_job` restricted to service role execution
   - Completion now validates running-state and lease validity
   - Completion includes worker identity checks to prevent unrelated completions
- `get_user_resources()` retry contract aligned for YouTube transcript failures (`can_retry = true` when eligible)

#### Transcript persistence strategy (updated)
- `transcript_text` remains persisted in `youtube_transcript_jobs.transcript_text` for audit/debug lineage
- Transcript content is now additionally persisted in dedicated retrieval storage:
   - `link_transcript_chunks` (chunk text, embedding, search_vector, access scope fields)
- Transcript metadata/state remains mirrored on `resource_links` (`transcript_status`, `transcript_error`, metadata lifecycle)

#### Files created/updated in this pass
- `supabase/migrations/20260409020000_transcript_async_flow.sql` — NEW
- `supabase/functions/youtube-transcript-worker/index.ts` — NEW
- `src/hooks/useResourceActions.ts` — UPDATED (`useRetryYouTubeTranscriptIngestion` + worker kick)
- `src/lib/resourceClassification.ts` — UPDATED (`transcriptError` field mapping)
- `src/integrations/supabase/types.ts` — UPDATED (transcript queue RPC typings + `transcript_error`)
- `src/components/views/ResourcesLanding.tsx` — UPDATED (drawer transcript error + retry action)
- `supabase/migrations/20260409024500_transcript_worker_security_hardening.sql` — NEW

### Pass 7 — ✅ COMPLETED

#### Delivered in this pass
- Added dedicated transcript chunk persistence + retrieval/index path
   - New table: `link_transcript_chunks`
   - Embedding index + full-text search vector index
   - New RPCs:
      - `search_link_transcript_chunks(...)`
      - `get_link_transcript_preview(...)`
- Updated transcript worker to persist chunked transcript content with embeddings before completion
- Extended transcript completion RPC to track persisted chunk count metadata
- Added transcript semantic retrieval into `hybrid-retrieval` so chat grounding can use transcript chunks
- Added transcript preview/query tab in Resources drawer
   - Tabbed UI (`Overview` / `Transcript`)
   - Search inside transcript excerpts via RPC
- Added automatic background schedule baseline for transcript worker
   - pg_cron + pg_net schedule attempts to run worker every minute when extensions are available

#### Files created/updated in this pass
- `supabase/migrations/20260409034000_transcript_chunks_and_schedule.sql` — NEW
- `supabase/functions/youtube-transcript-worker/index.ts` — UPDATED (chunk persistence)
- `supabase/functions/hybrid-retrieval/index.ts` — UPDATED (transcript semantic retrieval integration)
- `src/hooks/useResourceTranscriptPreview.ts` — NEW
- `src/components/views/ResourcesLanding.tsx` — UPDATED (transcript tab + query UX)
- `src/integrations/supabase/types.ts` — UPDATED (transcript preview/search RPC typings)
- `supabase/config.toml` — UPDATED (`youtube-transcript-worker` function config)

### Planned
- Source type/provider architecture for linked/synced resources (baseline delivered with enrichment)
- Media resource adapters (YouTube transcript retrieval path delivered; next: richer metadata + additional providers)
- Grid/card view toggle
- Resource detail panel/drawer (implemented baseline; can be extended with richer history/previews)
- Bulk actions
- Download functionality (baseline implemented for uploaded file resources)

### How future resource types plug in
1. Add new source adapter in backend (e.g., `get_youtube_resources()`)
2. UNION into `get_user_resources` or create a new unified RPC
3. Frontend Resource type already supports audio/video/link — just populate
4. Add new SourceProvider values and icons
5. Extend ReadinessStatus for new states (syncing, transcript_ready, etc.)
