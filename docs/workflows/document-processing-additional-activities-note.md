# Additional Document Activities (Additive, Not Wired)

Date: 2026-04-04

This note records additive handler capabilities introduced for future workflow expansion.

## Newly added handler keys

1. document.detect_file_type
2. document.inspect_pdf_text_layer
3. document.ocr_pdf
4. document.ocr_image
5. document.persist_analysis_metadata
6. document.compute_file_fingerprint

## Wiring status

These handlers are registered and callable by key, but intentionally not wired into any active workflow definition/DAG yet.

Current active document-processing workflow behavior remains unchanged.

## Implementation status

- document.detect_file_type: implemented
- document.inspect_pdf_text_layer: implemented
- document.ocr_pdf: deterministic placeholder (OCR integration deferred)
- document.ocr_image: deterministic placeholder (OCR integration deferred)
- document.persist_analysis_metadata: implemented
- document.compute_file_fingerprint: implemented

## Safety

- No schema changes
- No migration/RLS/helper SQL changes
- No trigger/cutover/retry routing changes
- Additive only
