# Google Drive as a Source Provider

Goal: let users search their connected Google Drive from the existing global "Add Source" dialog, pick a supported file, and have it land in Resources via the same pipeline as URL / upload sources. Read-only, manual add only, no separate Google Docs source type.

## Prerequisite

The Google Drive connector exists in the workspace ("Marko's Google Drive") but is **not yet linked to this project**. I will trigger `standard_connectors--connect` for `google_drive` so `LOVABLE_API_KEY` and `GOOGLE_DRIVE_API_KEY` become available to edge functions. Without this, every search/ingest call will fail.

## Scope (v1)

- Search Drive files (by name) through the connector gateway
- Optional MIME type filter: All / Docs / PDFs / Text & Markdown
- Pick one file, click "Add selected source"
- Supported MIME types:
  - `application/vnd.google-apps.document` → exported as `text/markdown`
  - `application/pdf`
  - `text/plain`, `text/markdown`
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX)
- Unsupported files render disabled with "Not supported yet"
- Provider stored as `google_drive`, source title = Drive file name, original webViewLink kept for the "open original" action
- Re-uses existing Resources/Chat/Notebook/Project listing — no new top-level UI

Out of scope: separate Google Docs source type, automatic background sync, write actions, per-end-user OAuth.

## Architecture

```text
Add Source dialog (Drive tab)
        │  search query + mime filter
        ▼
edge fn: gdrive-search ──► gateway /google_drive/drive/v3/files
        │  picks fileId
        ▼
edge fn: gdrive-ingest
        │  1. metadata via gateway
        │  2. content: export Docs as text/markdown,
        │             alt=media for PDF/TXT/MD/DOCX
        │  3. upload bytes to Storage (documents bucket)
        │  4. insert into `documents` with provider metadata
        │  5. start existing document_processing workflow
        ▼
Existing chunking / embedding / RAG pipeline
        ▼
Resources list (labelled "Google Drive")
```

Drive files are ingested as **documents** (binary in Storage) rather than `resource_links`, so they reuse the existing PDF/DOCX/TXT/MD extraction pipeline already wired into chat/notebook retrieval. For Google Docs we export to Markdown bytes and store as a `.md` document. This avoids inventing a new indexing path.

## Database

Minimal additive migration on `public.documents`:

- `provider text` (default `local_upload`)
- `external_id text` (Drive fileId, unique per owner+provider)
- `external_url text` (webViewLink)
- `external_modified_at timestamptz`
- `external_metadata jsonb`

Index: `(owner_user_id, provider, external_id)` unique to prevent duplicate ingests of the same Drive file into the same scope. No changes to `resource_links`. Backfill is unnecessary — existing rows get `provider='local_upload'`.

`mapRpcRowToResource` already supports a `provider` field; the RPC `get_user_resources` will be updated to surface `documents.provider` so the UI can show the "Google Drive" badge.

## Edge Functions (new)

1. `gdrive-search`
   - Auth: validates Supabase JWT (active user)
   - Input: `{ query?: string, mimeFilter?: 'all'|'docs'|'pdf'|'text', pageToken?: string }`
   - Calls `GET https://connector-gateway.lovable.dev/google_drive/drive/v3/files` with `q`, `fields=files(id,name,mimeType,modifiedTime,size,owners,webViewLink,parents,iconLink)`, `pageSize=25`
   - Returns normalized list + `nextPageToken`
   - Headers: `Authorization: Bearer ${LOVABLE_API_KEY}`, `X-Connection-Api-Key: ${GOOGLE_DRIVE_API_KEY}`

2. `gdrive-ingest`
   - Input: `{ fileId, containerType: 'project'|'notebook', containerId }`
   - Validates user has write access to container (existing `check_item_permission` RPC)
   - Fetches metadata, branches on `mimeType` to choose export vs alt=media, enforces 25 MB cap
   - Uploads bytes to Storage path `documents/{userId}/{uuid}.{ext}`
   - Inserts `documents` row with provider/external fields and kicks the existing document_processing workflow via `workflow-start`
   - Returns `{ documentId, status }`

Both functions return friendly error envelopes for: connector not linked, 401/403 (insufficient scope), 404 (file gone), unsupported mime, export failure, oversize file, gateway 5xx.

## Frontend Changes

- `AddSourceDialog` (in `src/components/views/ResourcesLanding.tsx`)
  - Mark `google_drive` as `implemented: true`
  - When provider = `google_drive`, swap the URL panel for a new `GoogleDrivePicker` subcomponent:
    - search input (debounced 300 ms)
    - mime filter chips
    - virtualized result rows: icon + name + owner + modified + folder/parent
    - row click selects (radio-style); unsupported rows show disabled
    - "Connector not linked" empty state with CTA pointing user to settings
  - "Add selected source" calls a new `useIngestGoogleDriveFile` mutation that hits `gdrive-ingest`
  - Existing URL and upload flows untouched

- New `useGoogleDriveSearch` / `useIngestGoogleDriveFile` hooks in `src/hooks/useGoogleDrive.ts`

- Resource UI: provider badge "Google Drive" (already pluggable through `SOURCE_PROVIDER` styling) and "Open in Drive" link via `external_url`

## Error & Permission Handling

- Read-only Drive scopes only; no write requests
- Server enforces RBAC on the target container before insert
- Surface user-friendly toasts for: not linked, no scopes, no results, unsupported, too large, export failed
- Log full upstream response server-side, return sanitized message to client

## i18n

Add keys under `resources.addSourceDialog.googleDrive.*` in `en.json` and `sr.json` (search placeholder, filter labels, empty/error states, "Add selected source", "Open in Drive").

## Acceptance verification

- Connector linked → search returns results, ingest creates a `documents` row with `provider='google_drive'`, file appears in Resources with the Drive badge and works in chat/notebook context.
- Connector unlinked → dialog shows the "Not connected" state instead of breaking.
- Existing URL and file-upload sources continue to work unchanged.

## Open questions before I start

1. Confirm I should call `standard_connectors--connect` for `google_drive` now to link it to this project — without that the feature can't run end-to-end.
2. OK to ingest Drive files as `documents` (reusing PDF/DOCX/MD extraction), rather than as `resource_links`?
3. Hard cap at 25 MB per file for v1 — acceptable?
