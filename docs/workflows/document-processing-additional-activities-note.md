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
- document.ocr_pdf: partially real
- document.ocr_image: real (AI-gateway multimodal OCR)
- document.persist_analysis_metadata: implemented
- document.compute_file_fingerprint: implemented

## OCR implementation details

Chosen OCR integrations:
- Image OCR: Lovable AI gateway multimodal endpoint (model: google/gemini-2.5-flash-lite) via shared OCR helper.
- PDF OCR: hybrid strategy.
	- If PDF has selectable text layer: OCR not required; text-layer extraction is returned.
	- If likely scanned: optional external OCR service integration via environment variables:
		- PDF_OCR_SERVICE_URL
		- PDF_OCR_SERVICE_TOKEN
	- Without external service, scanned-PDF OCR remains explicitly deferred in Edge runtime.

Runtime constraints affecting PDF OCR:
- Supabase Edge runtime does not provide a practical, maintained, low-risk local PDF rasterization + OCR path today.
- Rendering PDF pages to images inside Edge for OCR is the main blocker for full in-runtime scanned-PDF OCR.

Wiring status reminder:
- These OCR activities are still registered but not wired into active workflow definitions yet.

## Safety

- No schema changes
- No migration/RLS/helper SQL changes
- No trigger/cutover/retry routing changes
- Additive only
