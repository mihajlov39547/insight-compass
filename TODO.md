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

## Phase 2 — NOT STARTED (Future extensibility hooks)

### Planned
- Source type/provider architecture for linked/synced resources
- "Add link" / "Connect source" entry points in UI
- Media resource adapters (YouTube, audio, video)
- Grid/card view toggle
- Resource detail panel/drawer
- Bulk actions
- Download functionality

### How future resource types plug in
1. Add new source adapter in backend (e.g., `get_youtube_resources()`)
2. UNION into `get_user_resources` or create a new unified RPC
3. Frontend Resource type already supports audio/video/link — just populate
4. Add new SourceProvider values and icons
5. Extend ReadinessStatus for new states (syncing, transcript_ready, etc.)
