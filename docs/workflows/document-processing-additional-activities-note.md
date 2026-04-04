# Additional Document Activities (Additive, Not Wired)

Date: 2026-04-04

This note records additive handler capabilities introduced for future workflow expansion.

## Newly added handler keys

1. document.detect_file_type
2. document.inspect_pdf_text_layer
3. document.extract_pdf_text
4. document.ocr_pdf
5. document.extract_docx_text
6. document.extract_doc_text
7. document.extract_spreadsheet_text
8. document.extract_presentation_text
9. document.extract_email_text
10. document.ocr_image
11. document.extract_image_metadata
12. document.persist_analysis_metadata
13. document.compute_file_fingerprint
14. document.detect_scanned_document
15. document.extract_plain_text_like_content
16. document.normalize_technical_analysis_output

## Wiring status

These handlers are registered and callable by key, but intentionally not wired into any active workflow definition/DAG yet.

Current active document-processing workflow behavior remains unchanged.

## Implementation status

- document.detect_file_type: implemented
- document.inspect_pdf_text_layer: implemented
- document.extract_pdf_text: implemented
- document.ocr_pdf: partially real
- document.extract_docx_text: implemented
- document.extract_doc_text: implemented (heuristic legacy DOC extraction)
- document.extract_spreadsheet_text: implemented (CSV full, XLS/XLSX package-backed with fallback)
- document.extract_presentation_text: partially real (PPTX implemented, legacy PPT deferred)
- document.extract_email_text: partially real (EML implemented, MSG deferred)
- document.ocr_image: real (Tesseract.js primary OCR)
- document.extract_image_metadata: implemented
- document.persist_analysis_metadata: implemented
- document.compute_file_fingerprint: implemented
- document.detect_scanned_document: implemented
- document.extract_plain_text_like_content: implemented
- document.normalize_technical_analysis_output: implemented

## Package / Tool choices

PDF:
- unpdf (already used in shared text extraction) for text-layer extraction and quality inspection.

OCR:
- Tesseract.js (v5) integrated directly as primary OCR engine.
- OCR language control via DOCUMENT_OCR_LANGS (default srp_latn+srp+eng).
- PDF scanned OCR uses Tesseract primary path after PDF page rasterization attempt.
- Optional external fallback for scanned PDFs remains available via:
  - NON_AI_OCR_SERVICE_URL / NON_AI_OCR_SERVICE_TOKEN
  - PDF_OCR_SERVICE_URL / PDF_OCR_SERVICE_TOKEN

DOCX / DOC:
- Existing non-AI extractors from shared text extraction module (ZIP/XML DOCX path and legacy DOC heuristic path).

Spreadsheets:
- xlsx package for XLS/XLSX parsing when available.
- CSV native parsing path.

Presentations:
- PPTX ZIP/XML slide text extraction.
- PPT legacy binary currently deferred.

Images:
- Header-based metadata extraction (PNG/JPEG/GIF/WEBP dimensions and format).

Email / text-like:
- EML header/body parser.
- plain-text-like extraction for txt/md/json/xml/csv/rtf/log.

## Runtime constraints

- Image OCR is practical and real via Tesseract.js in current runtime.
- Scanned-PDF OCR remains partial in some environments due PDF page rasterization constraints (OffscreenCanvas/pdfjs runtime support).
- When rasterization fails, scanned-PDF OCR may require external fallback service for completion.
- Legacy binary formats (PPT, MSG) are not fully supported in-runtime without additional external parser services.

Runtime constraints affecting scanned PDF OCR:
- Rendering PDF pages to images is the main blocker for universally reliable in-runtime scanned-PDF OCR.

Wiring status reminder:
- These OCR activities are still registered but not wired into active workflow definitions yet.

## Safety

- No schema changes
- No migration/RLS/helper SQL changes
- No trigger/cutover/retry routing changes
- Additive only
