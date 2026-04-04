# Document Analysis Status (Single Source of Truth)

Date: 2026-04-04
Status: active

## 1) Current Production Reality

Document processing is workflow-driven.

- Upload creates a `documents` row with `processing_status = uploaded`.
- Upload then starts workflow definition `document_processing_v1`.
- `workflow-worker` executes document activities.
- Stage/terminal writes remain in current domain tables (`documents`, `document_analysis`, `document_chunks`, `document_chunk_questions`).
- Existing dashboard/polling remains compatible because status still ends in `completed` / `failed`.

## 2) Active Workflow Activities (Used Now)

The current active document workflow uses these 11 activity keys:

1. `document.prepare_run`
2. `document.load_source`
3. `document.extract_text`
4. `document.assess_quality`
5. `document.detect_language_and_stats`
6. `document.generate_summary`
7. `document.build_search_index`
8. `document.chunk_text`
9. `document.generate_chunk_embeddings`
10. `document.generate_chunk_questions`
11. `document.finalize_document`

## 3) Registered And Ready, But Not Wired Into Active Workflow

These handlers are implemented and registered, but intentionally not in the active DAG yet:

1. `document.detect_file_type`
2. `document.inspect_pdf_text_layer`
3. `document.extract_pdf_text`
4. `document.extract_docx_text`
5. `document.extract_doc_text`
6. `document.extract_spreadsheet_text`
7. `document.ocr_image`
8. `document.extract_image_metadata`
9. `document.detect_scanned_document`
10. `document.extract_plain_text_like_content`
11. `document.normalize_technical_analysis_output`
12. `document.persist_analysis_metadata`
13. `document.compute_file_fingerprint`

## 4) Implemented But Partial / Deferred / Runtime-Constrained

1. `document.ocr_pdf`
- Tesseract.js path is implemented.
- If PDF has selectable text: OCR is `NOT_REQUIRED`.
- For scanned PDFs, OCR depends on successful page rasterization in current runtime.
- Optional external fallback may still be used when Tesseract path yields no text.

2. `document.extract_presentation_text`
- PPTX extraction implemented.
- Legacy binary PPT extraction deferred.

3. `document.extract_email_text`
- EML extraction implemented.
- MSG extraction deferred.

## 5) Non-AI Toolkit Coverage (Current)

### Fully practical now
- PDF text-layer extraction/inspection
- DOCX extraction
- DOC heuristic extraction
- CSV extraction
- XLS/XLSX extraction (package-backed, with fallback)
- Image metadata extraction (PNG/JPEG/GIF/WEBP)
- Image OCR via Tesseract.js
- Plain-text-like extraction (`txt`, `md`, `json`, `xml`, `csv`, `rtf`, `log`)

### Partial by runtime/format
- Scanned-PDF OCR (rasterization/runtime dependent)
- PPT (legacy binary)
- MSG

## 6) OCR Strategy (Current)

- Primary OCR engine: `tesseract.js`.
- OCR language configuration: `DOCUMENT_OCR_LANGS` (default currently aligned to `srp_latn+srp+eng`).
- Scanned-PDF OCR requires rasterized page images; this is the main practical runtime sensitivity.
- External OCR fallback remains optional for scanned-PDF cases where rasterization/OCR in runtime is insufficient.

## 7) Pending Work

1. Decide whether to wire additional non-AI activities into active DAG.
2. Improve scanned-PDF OCR reliability across runtime environments.
3. Add first-class legacy PPT parser strategy or explicitly keep deferred.
4. Add MSG parser strategy or explicitly keep deferred.
5. Add operational OCR observability (success rates, per-format diagnostics).

## 8) Compatibility and Safety

- No schema changes.
- No migration/RLS/helper SQL changes.
- No upload/cutover/retry routing changes in this consolidation.
- This document replaces older phase-specific notes as the single maintained status file.

## 9) Workflow Engine Contracts (Current)

### Handler execution model

- Handlers execute via worker dispatch and return structured `ok: true|false` outputs.
- Success payload may include lightweight `context_patch` orchestration metadata.
- Orchestration state transitions are managed by worker/orchestrator logic, not handler-side direct mutation.
- Unknown handler keys resolve as terminal handler-not-found errors.

### Context patch policy

- Context is a compact orchestration snapshot only.
- Large business payloads (full extracted text, chunks, embeddings) remain in domain tables.
- Patch merge is shallow top-level merge; later patch wins on key collision.

### Workflow finalization policy

Workflow remains in-progress while any activity is in:

- `pending`
- `queued`
- `claimed`
- `running`
- `waiting_retry`

Workflow finalizes `failed` when any required activity is terminal failure/cancelled.

Workflow finalizes `completed` when:

- no in-progress activities remain
- no required activities are failed/cancelled

Optional activities may fail without forcing workflow failure.

## 10) Validation Status (Current)

Historical workflow-orchestration validation coverage exists for:

- fan-out behavior
- fan-in behavior
- multi-entry branch behavior
- downstream scheduling idempotency

Validated scenarios were designed to confirm deterministic queue transitions and no duplicate downstream queuing under repeated scheduling calls.

## 11) Canonical Documentation Scope

This repository now keeps document-analysis documentation in three canonical files:

1. `README.md` (project overview and doc map)
2. `DOC_PROCESSING.md` (processing/retrieval implementation details)
3. `docs/workflows/document-analysis-status.md` (workflow state: active usage, ready-but-unwired, partial/deferred, pending work)