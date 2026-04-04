# Phase F - Document Workflow (Completed)

Status: completed. The durable workflow is the only document-processing path.

## Current State

The monolithic `process-document` Edge Function has been fully removed. Document processing is handled exclusively by the durable workflow engine.

### Upload Flow

1. Frontend uploads file to storage and creates a `documents` row with `processing_status = 'uploaded'`.
2. Frontend calls `workflow-start` with `definition_key = 'document_processing_v1'`.
3. Workflow engine executes the document processing DAG via `workflow-worker`.
4. Workflow handlers write stage progression and terminal states to domain tables.

### Retry Flow

Retry starts/restarts the workflow path. If an active workflow run exists for the document, it is reused rather than creating a duplicate.

### Dedupe

- Upload uses idempotency key `upload-workflow-{document_id}`.
- Active run check prevents duplicate pending/running runs.

### Error Handling

If `workflow-start` fails, the document is marked as `failed` with the error message to prevent orphaned rows.

## Dashboard Compatibility

No UI changes required. Workflow handlers write to the same domain tables:
- `documents.processing_status` progresses through stage values
- Terminal states remain `completed` / `failed`
- Existing polling assumptions remain compatible

## Historical Notes

- The monolithic `process-document` path was the original document-processing implementation.
- Phase F introduced workflow-first routing with monolith fallback.
- The monolith and fallback logic have been fully removed. The workflow path is now the sole processing path.
