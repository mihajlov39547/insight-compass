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

The current active document workflow uses a reliability-first staged DAG:

1. `document.prepare_run`
2. `document.load_source`
3. `document.compute_file_fingerprint`
4. `document.detect_file_type`
5. `document.persist_metadata.after_detect_type` (handler: `document.persist_analysis_metadata`)
6. `document.inspect_pdf_text_layer`
7. `document.persist_metadata.after_pdf_inspection` (handler: `document.persist_analysis_metadata`)
8. `document.extract_pdf_text`
9. `document.extract_docx_text`
10. `document.extract_doc_text`
11. `document.extract_spreadsheet_text`
12. `document.extract_presentation_text`
13. `document.extract_email_text`
14. `document.extract_plain_text_like_content`
15. `document.extract_image_metadata`
16. `document.ocr_image`
17. `document.extract_text_fallback` (handler: `document.extract_text`)
18. `document.normalize_output` (handler: `document.normalize_technical_analysis_output`)
19. `document.persist_metadata.after_normalize` (handler: `document.persist_analysis_metadata`)
20. `document.assess_quality`
21. `document.persist_metadata.after_quality` (handler: `document.persist_analysis_metadata`)
22. `document.detect_language_and_stats`
23. `document.persist_metadata.after_language_stats` (handler: `document.persist_analysis_metadata`)
24. `document.generate_summary`
25. `document.build_search_index`
26. `document.chunk_text`
27. `document.generate_chunk_embeddings`
28. `document.generate_chunk_questions` (optional)
29. `document.finalize_document`

## 3) Registered And Ready, But Not Wired Into Active Workflow

These handlers are implemented and registered, but intentionally not in the active DAG yet:

1. `document.ocr_pdf`
2. `document.detect_scanned_document`

## 4) Implemented But Partial / Deferred / Runtime-Constrained

1. `document.ocr_pdf`
- Parser-first path implemented using PDF.js text-layer inspection.
- If PDF has selectable text: OCR is `NOT_REQUIRED`.
- For scanned PDFs, OCR uses selective per-page Tesseract.js after PDF rasterization.
- Reliability still depends on runtime rasterization/canvas support.
- Optional external fallback may still be used when Tesseract path yields no text.

2. `document.extract_presentation_text`
- PPTX extraction is strong parser-first (`slides + notes` via ZIP/XML parsing).
- Legacy binary PPT remains partial/deferred unless a dedicated parser service is configured.

3. `document.extract_email_text`
- EML extraction uses `mailparser` as primary parser with structured fallback parser.
- MSG extraction uses `@kenjiuno/msgreader` parser path.
- Runtime/package compatibility can still yield partial behavior in constrained deployments.

## 5) Non-AI Toolkit Coverage (Current)

### Fully practical now
- PDF text-layer extraction/inspection
- DOCX extraction
- DOC heuristic extraction
- CSV extraction
- XLS/XLSX extraction (package-backed, with fallback)
- Image metadata extraction (PNG/JPEG/GIF/WEBP)
- Image OCR via Tesseract.js
- PPTX extraction with slide and notes text
- EML parsing with structured headers/body/attachments
- MSG parser-based extraction path
- Plain-text-like extraction (`txt`, `md`, `json`, `xml`, `csv`, `rtf`, `log`)

### Partial by runtime/format
- Scanned-PDF OCR (rasterization/runtime dependent)
- PPT (legacy binary)
- MSG in environments where parser runtime compatibility is limited
- No dedicated Node OCR/parser worker is introduced yet; service fallback remains optional

## 6) OCR Strategy (Current)

- Primary OCR engine: `tesseract.js`.
- OCR language configuration: `DOCUMENT_OCR_LANGS` (default currently aligned to `srp_latn+srp+eng`).
- Scanned-PDF OCR is parser-first and selective:
	- inspect PDF text layer first
	- OCR only pages with insufficient text
- Scanned-PDF OCR requires rasterized page images; this remains the main practical runtime sensitivity.
- External OCR fallback is secondary and only used when local OCR path yields no usable text.

## 6.1) Selected Non-AI Packages/Tools

- PDF inspection/rasterization: `pdfjs-dist`
- OCR engine: `tesseract.js`
- EML parsing: `mailparser`
- MSG parsing: `@kenjiuno/msgreader`
- PPTX parsing: ZIP/XML parser-first extraction (slides + notes)

## 7) Pending Work

1. Decide whether to wire additional non-AI activities into active DAG.
2. Improve scanned-PDF OCR reliability across runtime environments.
3. Decide whether to introduce a dedicated Node OCR/parser worker for scanned PDF and legacy binary formats.
4. Add first-class legacy PPT parser strategy or explicitly keep deferred.
5. Harden MSG parser compatibility across deployment targets.
6. Add operational OCR observability (success rates, per-format diagnostics).

## 7.1) Migration Note: Stuck `extracting_content`

For existing documents stuck in `extracting_content` from older runs:

1. Prefer normal retry action from the UI so a new run uses the current DAG.
2. If a run is stale, allow maintenance recovery to reclaim/fail stale activities first, then retry.
3. If manual intervention is required, set document status to `failed` with explicit reason and trigger retry, rather than leaving indefinite `extracting_content`.
4. Confirm new run created for `document_processing_v1` current version and that `document.detect_file_type` checkpoint appears in metadata.

## 8) Compatibility and Safety

- No schema changes.
- Migration updates workflow-definition data only (no RLS/helper SQL/schema changes).
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