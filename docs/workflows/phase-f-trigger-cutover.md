# Phase F - Document Workflow Cutover

Status: active (flag-gated), rollback-ready.

## Goal

Route document processing through the durable workflow engine by default, with a simple flag to fall back to the legacy process-document path.

## Cutover Control

Single feature flag:
- `VITE_DOCUMENT_WORKFLOW_CUTOVER_DISABLED=true`

Behavior:
1. Flag unset/false (default): upload/retry attempts workflow-start for definition `document_processing_v1`.
2. Flag set to `true`: upload/retry triggers `process-document` directly.
3. If workflow-start fails (when enabled): immediate fallback to `process-document`.

Rollback:
- Set `VITE_DOCUMENT_WORKFLOW_CUTOVER_DISABLED=true` and redeploy frontend.
- Upload and retry return to legacy `process-document` trigger path immediately.

## Upload Trigger Behavior

Upload path creates documents row exactly as before.

After successful row insert:
- Cutover enabled (default): call `workflow-start` with `trigger_entity_type=document`, `trigger_entity_id=document_id`.
- Cutover disabled: call `process-document` directly.

Input metadata sent to workflow-start:
- `document_id`
- `source` (upload_cutover / retry_cutover)
- `source_document_id`
- `source_storage_path`
- `cutover_mode=true`

Dedupe:
- Checks for existing active workflow_runs (pending/running) for same document and reuses existing run.
- Uses idempotency key `upload-workflow-{document_id}` for upload starts.

## Retry Behavior

Retry follows the same cutover routing logic:
- Cutover enabled (default): start workflow path first.
- If workflow start fails: fallback to `process-document`.

Retry semantics:
- If active workflow run exists for document (pending/running), retry does not create duplicate run.
- If no active run, retry starts a new workflow run (idempotency key omitted for retries to permit new attempts).

## Dashboard Compatibility

No UI redesign required.

Compatibility preserved because:
- `documents.processing_status` remains authoritative for polling and badges.
- Workflow handlers continue writing stage progression and final completed/failed states to documents table.
- Existing dashboard assumption remains valid: any status other than completed/failed is treated as processing.

## Safety Notes

- `process-document` remains available and callable.
- Workflow-start failures do not orphan document rows due to immediate fallback.
- Trigger path logs and return metadata can be inspected via network/devtools for route decisions.

## Validation Checklist

1. Flag set to `true`:
   - Upload calls `process-document` and document completes/fails as before.

2. Flag unset/false (default):
   - Upload starts workflow run for `document_processing_v1`.
   - activity_runs are created and processed.

3. Fallback:
   - Simulate workflow-start failure and confirm `process-document` is called.

4. Retry:
   - Retry uses workflow path when enabled.
   - Active run dedupe prevents duplicate pending/running runs.

5. Rollback:
   - Set flag to `true` and confirm upload/retry return to `process-document` trigger path.
