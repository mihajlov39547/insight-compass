# Phase F - Progressive Cutover at Trigger Layer

Status: active (flag-gated), additive, rollback-ready.

## Goal

Move document processing initiation to durable workflow start while keeping the legacy process-document function callable as fallback.

## Cutover Control

Feature flag:
- VITE_DOCUMENT_WORKFLOW_CUTOVER_DISABLED=true

Behavior:
1. Flag unset/false: upload/retry triggers process-document directly.
2. Flag true: upload/retry attempts workflow-start for definition document_processing_v1.
3. If workflow-start fails: immediate fallback to process-document.

Rollback:
- Set VITE_DOCUMENT_WORKFLOW_CUTOVER_DISABLED=false (or unset) and redeploy frontend.
- Upload and retry return to legacy process-document trigger path.

## Upload Trigger Behavior

Upload path still creates documents row exactly as before.

After successful row insert:
- Cutover enabled: call workflow-start with trigger_entity_type=document, trigger_entity_id=document_id.
- Includes input metadata:
  - document_id
  - source (upload_cutover)
  - source_document_id
  - source_storage_path
  - cutover_mode=true

Dedupe:
- Checks for existing active workflow_runs (pending/running) for same document and reuses existing run intent.
- Uses idempotency key upload-workflow-{document_id} for upload starts.

## Retry Behavior

Retry button now follows same routing logic:
- Cutover enabled: start workflow path first.
- If workflow start fails: fallback to process-document.

Retry semantics:
- If active workflow run exists for document (pending/running), retry does not create duplicate run.
- If no active run, retry starts a new workflow run (idempotency key omitted for retries to permit new attempts).

## Dashboard Compatibility

No UI redesign required.

Compatibility preserved because:
- documents.processing_status remains authoritative for polling and badges.
- Workflow handlers continue writing stage progression and final completed/failed states to documents table.
- Existing dashboard assumption remains valid: any status other than completed/failed is treated as processing.

## Safety Notes

- process-document remains available and callable.
- Workflow-start failures do not orphan document rows due to immediate fallback.
- Trigger path logs and return metadata can be inspected via network/devtools for route decisions.

## Validation Checklist

1. Flag off:
- Upload calls process-document and document completes/fails as before.

2. Flag on:
- Upload starts workflow run for document_processing_v1.
- activity_runs are created and processed.

3. Fallback:
- Simulate workflow-start failure and confirm process-document is called.

4. Retry:
- Retry uses workflow path when enabled.
- Active run dedupe prevents duplicate pending/running runs.

5. Rollback:
- Disable flag and confirm upload/retry return to process-document trigger path.
