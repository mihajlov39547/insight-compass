// @ts-nocheck
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  extractText,
  filterStructuralNoise,
  computeStructuralNoiseRatio,
  detectScript,
  detectLanguage,
  countStats,
  normalizeForSearch,
  categorizeFile,
  assessTextQuality,
} from "./text-extraction.ts";
import { chunkText, estimateTokenCount } from "./chunking.ts";
import { generateEmbeddingsLocal, localEmbedding } from "./embeddings.ts";
import { generateDocumentSummary } from "./summarization.ts";
import {
  runImageOcrViaTesseract,
  runPdfOcrViaTesseract,
  runPdfOcrViaExternalService,
} from "./ocr.ts";
import {
  extractPdfTextNonAi,
  extractDocxTextNonAi,
  extractDocTextNonAi,
  extractSpreadsheetTextNonAi,
  extractPresentationTextNonAi,
  extractEmailTextNonAi,
  extractPlainTextLikeContent,
  normalizeTechnicalAnalysisOutput,
} from "./non-ai-extraction.ts";
import { extractImageMetadata } from "./image-metadata.ts";
import { inspectPdfTextLayerDetailed } from "./pdf-rasterization.ts";

export const DOCUMENT_ACTIVE_STATES = new Set([
  "extracting_metadata",
  "extracting_content",
  "detecting_language",
  "summarizing",
  "indexing",
  "chunking",
  "generating_embeddings",
  "generating_chunk_questions",
]);

export class DocumentStageError extends Error {
  code: string;
  classification: "retryable" | "terminal";
  details?: unknown;

  constructor(
    message: string,
    options: {
      code: string;
      classification?: "retryable" | "terminal";
      details?: unknown;
    }
  ) {
    super(message);
    this.name = "DocumentStageError";
    this.code = options.code;
    this.classification = options.classification ?? "terminal";
    this.details = options.details;
  }
}

function toObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mergeMetadata(
  existing: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...toObject(existing),
    ...patch,
  };
}

async function persistExtractionCheckpoint(
  supabase: SupabaseClient,
  doc: any,
  options: {
    stageKey: string;
    extractorSelected: string;
    extractorStatus: string;
    extractedText?: string;
    warning?: string | null;
    ocrUsed?: boolean;
    metadataPatch?: Record<string, unknown>;
  }
): Promise<void> {
  const analysis = await loadDocumentAnalysisRow(supabase, doc.id);
  const selectedText = typeof options.extractedText === "string"
    ? options.extractedText
    : String(analysis?.extracted_text ?? "");

  const mergedMetadata = mergeMetadata(analysis?.metadata_json, {
    file_type_category: normalizeDocumentCategory(doc),
    extractor_selected: options.extractorSelected,
    extractor_status: options.extractorStatus,
    extracted_char_count: selectedText.length,
    extraction_warnings: options.warning ?? null,
    last_completed_stage: options.stageKey,
    ...(options.metadataPatch ?? {}),
  });

  const { error: upsertError } = await supabase
    .from("document_analysis")
    .upsert(
      {
        document_id: doc.id,
        user_id: doc.user_id,
        extracted_text: selectedText.slice(0, 500000),
        normalized_search_text: analysis?.normalized_search_text ?? null,
        metadata_json: mergedMetadata,
        ocr_used: options.ocrUsed ?? analysis?.ocr_used ?? false,
        indexed_at: analysis?.indexed_at ?? null,
      },
      { onConflict: "document_id" }
    );

  if (upsertError) {
    throw new DocumentStageError(`Failed to persist extraction checkpoint: ${upsertError.message}`, {
      code: "EXTRACTION_CHECKPOINT_PERSIST_FAILED",
      classification: "retryable",
      details: {
        document_id: doc.id,
        stage_key: options.stageKey,
        extractor_selected: options.extractorSelected,
      },
    });
  }
}

function normalizeDocumentCategory(doc: any): string {
  const fileType = String(doc?.file_type ?? "").toLowerCase();
  const mime = String(doc?.mime_type ?? "").toLowerCase();

  if (fileType) {
    return categorizeFile(fileType);
  }

  if (mime === "application/pdf") return "pdf";
  if (
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "word";
  }
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/")) return "text";
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime.includes("csv")
  ) {
    return "spreadsheet";
  }
  return "other";
}

// Phase extension note:
// The following stages are intentionally additive and not yet wired into
// current active workflow definitions. They are available for future DAG updates.

export async function detectFileTypeStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);

  const normalizedCategory = normalizeDocumentCategory(doc);
  const detectedFrom = doc.file_type ? "file_type" : "mime_or_extension";

  return {
    document_id: documentId,
    normalized_file_category: normalizedCategory,
    detected_from: detectedFrom,
    file_type: doc.file_type ?? null,
    mime_type: doc.mime_type ?? null,
  };
}

export async function inspectPdfTextLayerStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);

  const fileCategory = normalizeDocumentCategory(doc);
  if (fileCategory !== "pdf") {
    return {
      document_id: documentId,
      pdf_text_status: "NOT_PDF",
      page_count: doc.page_count ?? null,
      has_selectable_text: false,
    };
  }

  const bytes = await downloadDocumentSource(supabase, doc);
  const detailed = await inspectPdfTextLayerDetailed(bytes, {
    minCharsPerPage: Number(Deno.env.get("DOCUMENT_PDF_TEXT_MIN_CHARS_PER_PAGE") || 20),
    maxPages: Number(Deno.env.get("DOCUMENT_PDF_INSPECTION_MAX_PAGES") || 50),
  });

  const extraction = await extractText(bytes, doc.mime_type, doc.file_name);
  const extractionSuggestsText = extraction.quality.readable && extraction.text.trim().length >= 50;
  const hasSelectableText = detailed.has_selectable_text || extractionSuggestsText;
  const pdfTextStatus = hasSelectableText ? "HAS_SELECTABLE_TEXT" : "LIKELY_SCANNED";

  return {
    document_id: documentId,
    pdf_text_status: pdfTextStatus,
    page_count: detailed.page_count || doc.page_count || null,
    has_selectable_text: hasSelectableText,
    inspection_method: extraction.method,
    inspection_quality_score: extraction.quality.score,
    inspection_quality_reason: extraction.quality.reason,
    pages_with_text_count: detailed.pages_with_text_count,
    pages_without_text_count: detailed.pages_without_text_count,
    inspection_warning: detailed.warning ?? null,
  };
}

export async function ocrPdfStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const fileCategory = normalizeDocumentCategory(doc);

  if (fileCategory !== "pdf") {
    return {
      document_id: documentId,
      ocr_status: "NOT_REQUIRED",
      ocr_engine: null,
      extracted_text_length: 0,
      warning: "document is not PDF",
    };
  }

  const inspection = await inspectPdfTextLayerStage(supabase, documentId);
  const pdfTextStatus = String(inspection.pdf_text_status ?? "LIKELY_SCANNED");

  if (pdfTextStatus === "HAS_SELECTABLE_TEXT") {
    const bytes = await downloadDocumentSource(supabase, doc);
    const extraction = await extractText(bytes, doc.mime_type, doc.file_name);

    return {
      document_id: documentId,
      pdf_text_status: pdfTextStatus,
      ocr_status: "NOT_REQUIRED",
      ocr_engine: "pdf_text_layer",
      ocr_confidence: extraction.quality.score,
      extracted_text: extraction.text,
      extracted_text_length: extraction.text.length,
      page_count: inspection.page_count ?? null,
      warning: null,
    };
  }

  const bytes = await downloadDocumentSource(supabase, doc);
  const tesseractPdfOcr = await runPdfOcrViaTesseract(bytes, {
    languages: Deno.env.get("DOCUMENT_OCR_LANGS"),
    maxPages: Number(Deno.env.get("DOCUMENT_OCR_MAX_PDF_PAGES") || 8),
    scale: Number(Deno.env.get("DOCUMENT_OCR_PDF_SCALE") || 1.8),
  });

  if (tesseractPdfOcr.text.trim().length > 0) {
    return {
      document_id: documentId,
      pdf_text_status: pdfTextStatus,
      ocr_status: "COMPLETED",
      ocr_engine: tesseractPdfOcr.engine,
      ocr_model: tesseractPdfOcr.model ?? null,
      ocr_confidence: tesseractPdfOcr.confidence,
      extracted_text: tesseractPdfOcr.text,
      extracted_text_length: tesseractPdfOcr.text.length,
      page_count: tesseractPdfOcr.page_count ?? inspection.page_count ?? null,
      processed_page_count: tesseractPdfOcr.processed_page_count ?? null,
      processed_page_numbers: tesseractPdfOcr.processed_page_numbers ?? null,
      ocr_languages: tesseractPdfOcr.languages ?? null,
      warning: tesseractPdfOcr.warning ?? null,
      ocr_primary_path: "tesseract.js",
      ocr_fallback_used: false,
    };
  }

  const externalServiceUrl = Deno.env.get("PDF_OCR_SERVICE_URL") || Deno.env.get("NON_AI_OCR_SERVICE_URL");
  const externalServiceToken = Deno.env.get("PDF_OCR_SERVICE_TOKEN") || Deno.env.get("NON_AI_OCR_SERVICE_TOKEN");

  const externalPdfOcr = await runPdfOcrViaExternalService(
    bytes,
    externalServiceUrl,
    externalServiceToken
  );

  if (externalPdfOcr.text.trim().length > 0) {
    return {
      document_id: documentId,
      pdf_text_status: pdfTextStatus,
      ocr_status: "COMPLETED",
      ocr_engine: externalPdfOcr.engine,
      ocr_model: externalPdfOcr.model ?? null,
      ocr_confidence: externalPdfOcr.confidence,
      extracted_text: externalPdfOcr.text,
      extracted_text_length: externalPdfOcr.text.length,
      page_count: inspection.page_count ?? null,
      ocr_languages: tesseractPdfOcr.languages ?? null,
      ocr_primary_path: "tesseract.js",
      ocr_fallback_used: true,
      warning: [
        "Used external OCR fallback after Tesseract path produced no text",
        tesseractPdfOcr.warning,
        externalPdfOcr.warning,
      ].filter(Boolean).join(" | "),
    };
  }

  // Edge runtime cannot reliably rasterize PDF pages for local OCR; keep explicit partial-deferred output.
  return {
    document_id: documentId,
    pdf_text_status: pdfTextStatus,
    ocr_status: "UNAVAILABLE",
    ocr_engine: externalPdfOcr.engine,
    ocr_model: externalPdfOcr.model ?? null,
    ocr_confidence: externalPdfOcr.confidence,
    extracted_text: "",
    extracted_text_length: 0,
    page_count: inspection.page_count ?? null,
    processed_page_count: tesseractPdfOcr.processed_page_count ?? null,
    processed_page_numbers: tesseractPdfOcr.processed_page_numbers ?? null,
    ocr_languages: tesseractPdfOcr.languages ?? null,
    ocr_primary_path: "tesseract.js",
    ocr_fallback_used: false,
    warning:
      [
        tesseractPdfOcr.warning,
        externalPdfOcr.warning,
        "Scanned-PDF OCR requires successful PDF rasterization in Edge runtime or external fallback",
      ].filter(Boolean).join(" | "),
  };
}

export async function ocrImageStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const fileCategory = normalizeDocumentCategory(doc);

  if (fileCategory !== "image") {
    return {
      document_id: documentId,
      ocr_status: "NOT_REQUIRED",
      ocr_engine: null,
      extracted_text_length: 0,
      warning: "document is not image",
    };
  }

  const bytes = await downloadDocumentSource(supabase, doc);
  const ocr = await runImageOcrViaTesseract(
    bytes,
    String(doc.mime_type ?? "image/png"),
    Deno.env.get("DOCUMENT_OCR_LANGS")
  );

  const text = ocr.text.trim();
  if (!text) {
    await persistExtractionCheckpoint(supabase, doc, {
      stageKey: "document.ocr_image",
      extractorSelected: "tesseract.js_image_ocr",
      extractorStatus: "FAILED",
      extractedText: "",
      warning: ocr.warning ?? "Image OCR returned empty text",
      ocrUsed: true,
      metadataPatch: {
        ocr_engine: ocr.engine,
        ocr_confidence: ocr.confidence,
        ocr_languages: ocr.languages ?? null,
      },
    });

    return {
      document_id: documentId,
      ocr_status: "FAILED",
      ocr_engine: ocr.engine,
      ocr_model: ocr.model ?? null,
      ocr_confidence: ocr.confidence,
      ocr_languages: ocr.languages ?? null,
      extracted_text: "",
      extracted_text_length: 0,
      warning: ocr.warning ?? "Image OCR returned empty text",
    };
  }

  await persistExtractionCheckpoint(supabase, doc, {
    stageKey: "document.ocr_image",
    extractorSelected: "tesseract.js_image_ocr",
    extractorStatus: "COMPLETED",
    extractedText: text,
    warning: ocr.warning ?? null,
    ocrUsed: true,
    metadataPatch: {
      ocr_engine: ocr.engine,
      ocr_confidence: ocr.confidence,
      ocr_languages: ocr.languages ?? null,
    },
  });

  return {
    document_id: documentId,
    ocr_status: "COMPLETED",
    ocr_engine: ocr.engine,
    ocr_model: ocr.model ?? null,
    ocr_confidence: ocr.confidence,
    ocr_languages: ocr.languages ?? null,
    extracted_text: text,
    extracted_text_length: text.length,
    warning: ocr.warning ?? null,
  };
}

export async function extractPdfTextStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const category = normalizeDocumentCategory(doc);
  if (category !== "pdf") {
    return {
      document_id: documentId,
      extraction_status: "NOT_PDF",
      extracted_text: "",
      extracted_text_length: 0,
      method: null,
    };
  }

  const bytes = await downloadDocumentSource(supabase, doc);
  const extraction = await extractPdfTextNonAi(bytes, doc.mime_type, doc.file_name);
  const status = extraction.text.trim() ? "COMPLETED" : "EMPTY";

  await persistExtractionCheckpoint(supabase, doc, {
    stageKey: "document.extract_pdf_text",
    extractorSelected: extraction.method,
    extractorStatus: status,
    extractedText: extraction.text,
    warning: extraction.text.trim() ? null : extraction.quality_reason,
    metadataPatch: {
      quality_score: extraction.quality_score,
      quality_reason: extraction.quality_reason,
      pdf_text_status: status === "EMPTY" ? "LIKELY_SCANNED" : "HAS_SELECTABLE_TEXT",
    },
  });

  return {
    document_id: documentId,
    extraction_status: status,
    extracted_text: extraction.text,
    extracted_text_length: extraction.text.length,
    method: extraction.method,
    quality_score: extraction.quality_score,
    quality_reason: extraction.quality_reason,
  };
}

export async function extractDocxTextStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const ext = String(doc.file_type ?? "").toLowerCase();
  if (ext !== "docx") {
    return {
      document_id: documentId,
      extraction_status: "NOT_DOCX",
      extracted_text: "",
      extracted_text_length: 0,
      method: null,
    };
  }

  const bytes = await downloadDocumentSource(supabase, doc);
  const extraction = await extractDocxTextNonAi(bytes, doc.mime_type, doc.file_name);
  const status = extraction.text.trim() ? "COMPLETED" : "EMPTY";

  await persistExtractionCheckpoint(supabase, doc, {
    stageKey: "document.extract_docx_text",
    extractorSelected: extraction.method,
    extractorStatus: status,
    extractedText: extraction.text,
    warning: extraction.text.trim() ? null : extraction.quality_reason,
    metadataPatch: {
      quality_score: extraction.quality_score,
      quality_reason: extraction.quality_reason,
    },
  });

  return {
    document_id: documentId,
    extraction_status: status,
    extracted_text: extraction.text,
    extracted_text_length: extraction.text.length,
    method: extraction.method,
    quality_score: extraction.quality_score,
    quality_reason: extraction.quality_reason,
  };
}

export async function extractDocTextStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const ext = String(doc.file_type ?? "").toLowerCase();
  if (ext !== "doc") {
    return {
      document_id: documentId,
      extraction_status: "NOT_DOC",
      extracted_text: "",
      extracted_text_length: 0,
      method: null,
    };
  }

  const bytes = await downloadDocumentSource(supabase, doc);
  const extraction = await extractDocTextNonAi(bytes, doc.mime_type, doc.file_name);
  const status = extraction.text.trim() ? "COMPLETED" : "EMPTY";

  await persistExtractionCheckpoint(supabase, doc, {
    stageKey: "document.extract_doc_text",
    extractorSelected: extraction.method,
    extractorStatus: status,
    extractedText: extraction.text,
    warning: extraction.text.trim() ? null : extraction.quality_reason,
    metadataPatch: {
      quality_score: extraction.quality_score,
      quality_reason: extraction.quality_reason,
    },
  });

  return {
    document_id: documentId,
    extraction_status: status,
    extracted_text: extraction.text,
    extracted_text_length: extraction.text.length,
    method: extraction.method,
    quality_score: extraction.quality_score,
    quality_reason: extraction.quality_reason,
  };
}

export async function extractSpreadsheetTextStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const ext = String(doc.file_type ?? "").toLowerCase();
  if (!["xls", "xlsx", "csv"].includes(ext)) {
    return {
      document_id: documentId,
      extraction_status: "NOT_SPREADSHEET",
      extracted_text: "",
      extracted_text_length: 0,
      method: null,
    };
  }

  const bytes = await downloadDocumentSource(supabase, doc);
  const extraction = await extractSpreadsheetTextNonAi(bytes, doc.file_name);
  const status = extraction.text.trim() ? "COMPLETED" : "EMPTY";

  await persistExtractionCheckpoint(supabase, doc, {
    stageKey: "document.extract_spreadsheet_text",
    extractorSelected: extraction.method,
    extractorStatus: status,
    extractedText: extraction.text,
    warning: extraction.warning ?? null,
    metadataPatch: {
      sheet_count: extraction.sheet_count,
      row_count: extraction.row_count,
      column_count_estimate: extraction.column_count_estimate,
    },
  });

  return {
    document_id: documentId,
    extraction_status: status,
    extracted_text: extraction.text,
    extracted_text_length: extraction.text.length,
    method: extraction.method,
    sheet_count: extraction.sheet_count,
    row_count: extraction.row_count,
    column_count_estimate: extraction.column_count_estimate,
    warning: extraction.warning,
  };
}

export async function extractPresentationTextStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const ext = String(doc.file_type ?? "").toLowerCase();
  if (!["ppt", "pptx"].includes(ext)) {
    return {
      document_id: documentId,
      extraction_status: "NOT_PRESENTATION",
      extracted_text: "",
      extracted_text_length: 0,
      method: null,
    };
  }

  const bytes = await downloadDocumentSource(supabase, doc);
  const extraction = await extractPresentationTextNonAi(bytes, doc.file_name);
  const status = extraction.text.trim() ? "COMPLETED" : "EMPTY";

  await persistExtractionCheckpoint(supabase, doc, {
    stageKey: "document.extract_presentation_text",
    extractorSelected: extraction.method,
    extractorStatus: extraction.support_status ?? status,
    extractedText: extraction.text,
    warning: extraction.warning ?? null,
    metadataPatch: {
      presentation_type: extraction.presentation_type ?? ext,
      slide_count: extraction.slide_count,
      notes_count: extraction.notes_count ?? null,
      parser_warnings: extraction.parser_warnings ?? [],
      support_status: extraction.support_status ?? "partial",
    },
  });

  return {
    document_id: documentId,
    extraction_status: status,
    extracted_text: extraction.text,
    extracted_text_length: extraction.text.length,
    presentation_type: extraction.presentation_type ?? ext,
    support_status: extraction.support_status ?? "partial",
    method: extraction.method,
    slide_count: extraction.slide_count,
    notes_count: extraction.notes_count ?? null,
    parser_warnings: extraction.parser_warnings ?? [],
    warning: extraction.warning,
  };
}

export async function extractEmailTextStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const ext = String(doc.file_type ?? "").toLowerCase();
  if (![
    "eml",
    "msg",
  ].includes(ext)) {
    return {
      document_id: documentId,
      extraction_status: "NOT_EMAIL",
      extracted_text: "",
      extracted_text_length: 0,
      method: null,
    };
  }

  const bytes = await downloadDocumentSource(supabase, doc);
  const extraction = await extractEmailTextNonAi(bytes, doc.file_name, doc.mime_type);
  const status = extraction.text.trim() ? "COMPLETED" : "EMPTY";

  await persistExtractionCheckpoint(supabase, doc, {
    stageKey: "document.extract_email_text",
    extractorSelected: extraction.method,
    extractorStatus: extraction.support_status ?? status,
    extractedText: extraction.text,
    warning: Array.isArray(extraction.parser_warnings) && extraction.parser_warnings.length > 0
      ? extraction.parser_warnings.join(" | ")
      : null,
    metadataPatch: {
      support_status: extraction.support_status ?? "partial",
      email_subject: extraction.subject,
      email_from: extraction.from,
      email_to: extraction.to ?? null,
      email_cc: extraction.cc ?? null,
      email_bcc: extraction.bcc ?? null,
      email_sent_date: extraction.sent_date ?? extraction.date ?? null,
      email_has_html: extraction.has_html ?? false,
      attachment_count: extraction.attachment_count ?? 0,
      parser_warnings: extraction.parser_warnings ?? [],
    },
  });

  return {
    document_id: documentId,
    extraction_status: status,
    extracted_text: extraction.text,
    extracted_text_length: extraction.text.length,
    support_status: extraction.support_status ?? "partial",
    method: extraction.method,
    email_subject: extraction.subject,
    email_from: extraction.from,
    email_to: extraction.to ?? null,
    email_cc: extraction.cc ?? null,
    email_bcc: extraction.bcc ?? null,
    email_date: extraction.sent_date ?? extraction.date ?? null,
    email_has_html: extraction.has_html ?? false,
    email_body_html: extraction.body_html ?? null,
    attachment_count: extraction.attachment_count ?? 0,
    attachments: extraction.attachments ?? [],
    parser_warnings: extraction.parser_warnings ?? [],
    warning: Array.isArray(extraction.parser_warnings) && extraction.parser_warnings.length > 0
      ? extraction.parser_warnings.join(" | ")
      : null,
  };
}

export async function extractImageMetadataStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const category = normalizeDocumentCategory(doc);
  if (category !== "image") {
    return {
      document_id: documentId,
      image_metadata_status: "NOT_IMAGE",
      image_width: null,
      image_height: null,
      image_format: null,
      warning: null,
    };
  }

  const bytes = await downloadDocumentSource(supabase, doc);
  const metadata = extractImageMetadata(bytes);

  return {
    document_id: documentId,
    image_metadata_status: metadata.width && metadata.height ? "COMPLETED" : "PARTIAL",
    image_width: metadata.width,
    image_height: metadata.height,
    image_format: metadata.format,
    warning: metadata.warning ?? null,
  };
}

export async function detectScannedDocumentStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const category = normalizeDocumentCategory(doc);
  if (category !== "pdf") {
    return {
      document_id: documentId,
      scanned_document_status: "NOT_PDF",
      likely_scanned: false,
      pdf_text_status: "NOT_PDF",
    };
  }

  const inspection = await inspectPdfTextLayerStage(supabase, documentId);
  const pdfTextStatus = String(inspection.pdf_text_status ?? "LIKELY_SCANNED");

  return {
    document_id: documentId,
    scanned_document_status: pdfTextStatus === "LIKELY_SCANNED" ? "LIKELY_SCANNED" : "HAS_SELECTABLE_TEXT",
    likely_scanned: pdfTextStatus === "LIKELY_SCANNED",
    pdf_text_status: pdfTextStatus,
    inspection_method: inspection.inspection_method ?? null,
  };
}

export async function extractPlainTextLikeContentStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const bytes = await downloadDocumentSource(supabase, doc);
  const extraction = extractPlainTextLikeContent(bytes, doc.file_name);
  const status = extraction.text.trim() ? "COMPLETED" : "EMPTY";

  await persistExtractionCheckpoint(supabase, doc, {
    stageKey: "document.extract_plain_text_like_content",
    extractorSelected: extraction.method,
    extractorStatus: status,
    extractedText: extraction.text,
    warning: extraction.warning ?? null,
    metadataPatch: {
      word_count: extraction.word_count,
      char_count: extraction.char_count,
    },
  });

  return {
    document_id: documentId,
    extraction_status: status,
    extracted_text: extraction.text,
    extracted_text_length: extraction.text.length,
    method: extraction.method,
    word_count: extraction.word_count,
    char_count: extraction.char_count,
    warning: extraction.warning,
  };
}

export async function normalizeTechnicalAnalysisOutputStage(
  supabase: SupabaseClient,
  documentId: string,
  rawInput?: unknown
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const analysis = await loadDocumentAnalysisRow(supabase, documentId);

  const normalized = normalizeTechnicalAnalysisOutput(
    {
      ...(toObject(rawInput)),
      extracted_text: toObject(rawInput).extracted_text ?? analysis?.extracted_text ?? "",
      warning: toObject(rawInput).warning ?? null,
    },
    doc.file_name
  );

  const fileCategory = normalizeDocumentCategory(doc);
  const normalizedText = String(normalized.normalized_extracted_text ?? "").trim();

  if (!normalizedText && fileCategory !== "image") {
    throw new DocumentStageError("Normalized extraction output is empty", {
      code: "EXTRACTION_EMPTY_OUTPUT",
      classification: "terminal",
      details: {
        document_id: documentId,
        file_category: fileCategory,
      },
    });
  }

  await persistExtractionCheckpoint(supabase, doc, {
    stageKey: "document.normalize_technical_analysis_output",
    extractorSelected: "normalized_output",
    extractorStatus: normalizedText ? "COMPLETED" : "EMPTY_ALLOWED",
    extractedText: normalizedText,
    warning: typeof normalized.warning === "string" ? normalized.warning : null,
    metadataPatch: {
      normalized_text_length: normalized.normalized_text_length,
      normalized_word_count: normalized.word_count,
      normalized_char_count: normalized.char_count,
      normalized_line_count: normalized.line_count,
      last_completed_stage: "document.normalize_technical_analysis_output",
    },
  });

  return {
    document_id: documentId,
    ...normalized,
  };
}

export async function persistAnalysisMetadataStage(
  supabase: SupabaseClient,
  documentId: string,
  metadataPatchInput?: unknown
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const analysis = await loadDocumentAnalysisRow(supabase, documentId);

  const metadataPatch = toObject(metadataPatchInput);
  const persistedAt = new Date().toISOString();

  const mergedMetadata = mergeMetadata(analysis?.metadata_json, {
    ...metadataPatch,
    metadata_persisted_at: persistedAt,
    metadata_persisted_by: "document.persist_analysis_metadata",
  });

  const { error: upsertError } = await supabase
    .from("document_analysis")
    .upsert(
      {
        document_id: documentId,
        user_id: doc.user_id,
        extracted_text: analysis?.extracted_text ?? null,
        normalized_search_text: analysis?.normalized_search_text ?? null,
        metadata_json: mergedMetadata,
        ocr_used: analysis?.ocr_used ?? false,
        indexed_at: analysis?.indexed_at ?? null,
      },
      { onConflict: "document_id" }
    );

  if (upsertError) {
    throw new DocumentStageError(`Failed to persist analysis metadata: ${upsertError.message}`, {
      code: "PERSIST_ANALYSIS_METADATA_FAILED",
      classification: "retryable",
    });
  }

  return {
    document_id: documentId,
    metadata_keys_written: Object.keys(metadataPatch),
    metadata_persisted_at: persistedAt,
  };
}

export async function computeFileFingerprintStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const bytes = await downloadDocumentSource(supabase, doc);

  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return {
    document_id: documentId,
    fingerprint_sha256: hash,
    byte_length: bytes.length,
    fingerprint_algo: "sha256",
  };
}

export async function loadDocumentRow(
  supabase: SupabaseClient,
  documentId: string
): Promise<any> {
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .single();

  if (error || !data) {
    throw new DocumentStageError("Document not found", {
      code: "DOCUMENT_NOT_FOUND",
      classification: "terminal",
      details: error?.message ?? null,
    });
  }

  return data;
}

export async function loadDocumentAnalysisRow(
  supabase: SupabaseClient,
  documentId: string
): Promise<any | null> {
  const { data, error } = await supabase
    .from("document_analysis")
    .select("*")
    .eq("document_id", documentId)
    .maybeSingle();

  if (error) {
    throw new DocumentStageError(`Failed to load document_analysis: ${error.message}`, {
      code: "DOCUMENT_ANALYSIS_LOAD_FAILED",
      classification: "retryable",
    });
  }

  return data ?? null;
}

export async function downloadDocumentSource(
  supabase: SupabaseClient,
  doc: any
): Promise<Uint8Array> {
  const { data: fileData, error: dlErr } = await supabase.storage
    .from("insight-navigator")
    .download(doc.storage_path);

  if (dlErr || !fileData) {
    const message = `Download failed: ${dlErr?.message || "unknown"}`;
    throw new DocumentStageError(message, {
      code: "DOCUMENT_DOWNLOAD_FAILED",
      classification: "retryable",
      details: { storage_path: doc.storage_path },
    });
  }

  return new Uint8Array(await fileData.arrayBuffer());
}

export async function prepareRunStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);

  if (doc.processing_status === "completed") {
    return {
      document_id: documentId,
      status: "already_completed",
      processing_status: doc.processing_status,
    };
  }

  if (DOCUMENT_ACTIVE_STATES.has(doc.processing_status)) {
    return {
      document_id: documentId,
      status: "already_processing",
      processing_status: doc.processing_status,
    };
  }

  const { error } = await supabase
    .from("documents")
    .update({
      processing_status: "extracting_metadata",
      processing_error: null,
      retry_count: (doc.retry_count || 0) + 1,
      last_retry_at: new Date().toISOString(),
    })
    .eq("id", documentId);

  if (error) {
    throw new DocumentStageError(`Failed to update prepare_run state: ${error.message}`, {
      code: "PREPARE_RUN_UPDATE_FAILED",
      classification: "retryable",
    });
  }

  return {
    document_id: documentId,
    status: "prepared",
    retry_count: (doc.retry_count || 0) + 1,
  };
}

export async function loadSourceStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);

  const { error: stageError } = await supabase
    .from("documents")
    .update({ processing_status: "extracting_content" })
    .eq("id", documentId);

  if (stageError) {
    throw new DocumentStageError(`Failed to set extracting_content: ${stageError.message}`, {
      code: "LOAD_SOURCE_STAGE_UPDATE_FAILED",
      classification: "retryable",
    });
  }

  const bytes = await downloadDocumentSource(supabase, doc);

  return {
    document_id: documentId,
    source_available: true,
    content_length: bytes.length,
    storage_path: doc.storage_path,
    mime_type: doc.mime_type,
    file_name: doc.file_name,
  };
}

export async function extractTextStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const fileCategory = normalizeDocumentCategory(doc);

  const knownTypeExtensions = new Set([
    "pdf",
    "docx",
    "doc",
    "xls",
    "xlsx",
    "csv",
    "ppt",
    "pptx",
    "eml",
    "msg",
    "txt",
    "md",
    "rtf",
    "xml",
    "json",
    "log",
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
  ]);

  const ext = String(doc.file_type ?? "").toLowerCase();
  const hasDedicatedPath =
    knownTypeExtensions.has(ext) ||
    ["pdf", "image", "spreadsheet"].includes(fileCategory);

  if (hasDedicatedPath) {
    const fallbackReason = fileCategory === "pdf"
      ? "pdf_requires_ocr_not_enabled"
      : "known file type should use dedicated extractor activities";

    return {
      document_id: documentId,
      extraction_method: fileCategory === "pdf"
        ? "pdf_scanned_requires_ocr"
        : "generic_fallback_skipped",
      extraction_encoding: null,
      structural_noise_filtered: null,
      script_primary: null,
      quality_score: null,
      quality_reason: fallbackReason,
      readable: null,
      raw_text_length: 0,
      cleaned_text_length: 0,
      line_count: 0,
      fallback_used: true,
    };
  }

  const bytes = await downloadDocumentSource(supabase, doc);

  const extraction = await extractText(bytes, doc.mime_type, doc.file_name);
  const cleanedText = filterStructuralNoise(extraction.text);
  const effectiveText = cleanedText.length > 50 ? cleanedText : extraction.text;
  const stats = countStats(effectiveText);
  const scriptInfo = detectScript(effectiveText);
  const noiseRatio = computeStructuralNoiseRatio(extraction.text);

  const metadataPatch = {
    original_size: doc.file_size,
    mime_type: doc.mime_type,
    extraction_method: extraction.method,
    extraction_encoding: extraction.encoding || null,
    quality_score: extraction.quality.score,
    readable_char_ratio: extraction.quality.readableCharRatio,
    pdf_syntax_ratio: extraction.quality.pdfSyntaxRatio,
    structural_noise_ratio: noiseRatio,
    structural_noise_filtered: cleanedText.length < extraction.text.length,
    quality_reason: extraction.quality.reason,
    extraction_readable: extraction.quality.readable,
    file_category: categorizeFile(doc.file_type),
    detected_script: scriptInfo.primary,
    script_ratios: {
      latin: scriptInfo.latinRatio,
      cyrillic: scriptInfo.cyrillicRatio,
      arabic: scriptInfo.arabicRatio,
      cjk: scriptInfo.cjkRatio,
    },
    line_count: stats.line_count,
  };

  const currentAnalysis = await loadDocumentAnalysisRow(supabase, documentId);

  const { error: upsertError } = await supabase.from("document_analysis").upsert(
    {
      document_id: documentId,
      user_id: doc.user_id,
      extracted_text: effectiveText.slice(0, 500000),
      normalized_search_text: currentAnalysis?.normalized_search_text ?? null,
      metadata_json: mergeMetadata(currentAnalysis?.metadata_json, metadataPatch),
      ocr_used: false,
    },
    { onConflict: "document_id" }
  );

  if (upsertError) {
    throw new DocumentStageError(`Failed to persist extracted text: ${upsertError.message}`, {
      code: "EXTRACT_TEXT_PERSIST_FAILED",
      classification: "retryable",
    });
  }

  await persistExtractionCheckpoint(supabase, doc, {
    stageKey: "document.extract_text",
    extractorSelected: extraction.method,
    extractorStatus: extraction.quality.readable ? "COMPLETED" : "QUALITY_WARNING",
    extractedText: effectiveText,
    warning: extraction.quality.readable ? null : extraction.quality.reason,
    metadataPatch,
  });

  return {
    document_id: documentId,
    extraction_method: extraction.method,
    extraction_encoding: extraction.encoding || null,
    structural_noise_filtered: cleanedText.length < extraction.text.length,
    script_primary: scriptInfo.primary,
    quality_score: extraction.quality.score,
    quality_reason: extraction.quality.reason,
    readable: extraction.quality.readable,
    raw_text_length: extraction.text.length,
    cleaned_text_length: effectiveText.length,
    line_count: stats.line_count,
  };
}

export async function assessQualityStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const analysis = await loadDocumentAnalysisRow(supabase, documentId);

  if (!analysis?.extracted_text) {
    throw new DocumentStageError("No extracted text available for quality assessment", {
      code: "ASSESS_QUALITY_MISSING_TEXT",
      classification: "terminal",
    });
  }

  const meta = toObject(analysis.metadata_json);
  const qualityReadable = typeof meta.extraction_readable === "boolean"
    ? Boolean(meta.extraction_readable)
    : assessTextQuality(analysis.extracted_text).readable;

  const qualityScore = Number(meta.quality_score ?? 0);
  const qualityReason = String(meta.quality_reason ?? "unknown");

  if (!qualityReadable) {
    const stats = countStats(analysis.extracted_text);

    const { error: failError } = await supabase
      .from("documents")
      .update({
        processing_status: "failed",
        processing_error: `Text extraction failed: ${qualityReason} (method: ${String(meta.extraction_method ?? "unknown")}, encoding: ${String(meta.extraction_encoding ?? "n/a")}, score: ${qualityScore})`,
        word_count: stats.word_count,
        char_count: stats.char_count,
      })
      .eq("id", documentId);

    if (failError) {
      throw new DocumentStageError(`Failed to persist quality failure state: ${failError.message}`, {
        code: "ASSESS_QUALITY_FAIL_UPDATE_FAILED",
        classification: "retryable",
      });
    }

    throw new DocumentStageError("Text extraction quality gate failed", {
      code: "ASSESS_QUALITY_UNREADABLE",
      classification: "terminal",
      details: {
        document_id: documentId,
        quality_reason: qualityReason,
        quality_score: qualityScore,
      },
    });
  }

  return {
    document_id: documentId,
    readable: true,
    quality_score: qualityScore,
    quality_reason: qualityReason,
  };
}

export async function detectLanguageAndStatsStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const analysis = await loadDocumentAnalysisRow(supabase, documentId);
  const doc = await loadDocumentRow(supabase, documentId);

  if (!analysis?.extracted_text) {
    throw new DocumentStageError("Missing extracted_text for detect_language_and_stats", {
      code: "LANG_STATS_MISSING_TEXT",
      classification: "terminal",
    });
  }

  const effectiveText = analysis.extracted_text;
  const stats = countStats(effectiveText);
  const langResult = detectLanguage(effectiveText);
  const scriptInfo = detectScript(effectiveText);

  const { error: docUpdateError } = await supabase
    .from("documents")
    .update({
      processing_status: "detecting_language",
      word_count: stats.word_count,
      char_count: stats.char_count,
      detected_language: langResult.language,
    })
    .eq("id", documentId);

  if (docUpdateError) {
    throw new DocumentStageError(`Failed to persist language/stats: ${docUpdateError.message}`, {
      code: "LANG_STATS_UPDATE_FAILED",
      classification: "retryable",
    });
  }

  const currentMeta = toObject(analysis.metadata_json);
  const { error: analysisUpdateError } = await supabase
    .from("document_analysis")
    .update({
      metadata_json: {
        ...currentMeta,
        word_count: stats.word_count,
        char_count: stats.char_count,
        line_count: stats.line_count,
        detected_language: langResult.language,
        detected_script: langResult.script,
        language_confidence: langResult.confidence,
        script_ratios: {
          latin: scriptInfo.latinRatio,
          cyrillic: scriptInfo.cyrillicRatio,
          arabic: scriptInfo.arabicRatio,
          cjk: scriptInfo.cjkRatio,
        },
      },
    })
    .eq("document_id", documentId);

  if (analysisUpdateError) {
    throw new DocumentStageError(`Failed to update analysis metadata: ${analysisUpdateError.message}`, {
      code: "LANG_STATS_METADATA_UPDATE_FAILED",
      classification: "retryable",
    });
  }

  return {
    document_id: documentId,
    detected_language: langResult.language,
    detected_script: langResult.script,
    language_confidence: langResult.confidence,
    word_count: stats.word_count,
    char_count: stats.char_count,
  };
}

export async function generateSummaryStage(
  supabase: SupabaseClient,
  documentId: string,
  lovableApiKey?: string | null
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const analysis = await loadDocumentAnalysisRow(supabase, documentId);

  const { error: stageError } = await supabase
    .from("documents")
    .update({ processing_status: "summarizing" })
    .eq("id", documentId);

  if (stageError) {
    throw new DocumentStageError(`Failed to set summarizing status: ${stageError.message}`, {
      code: "SUMMARY_STAGE_UPDATE_FAILED",
      classification: "retryable",
    });
  }

  const effectiveText = String(analysis?.extracted_text ?? "");
  const script = String((toObject(analysis?.metadata_json).detected_script as string) ?? "unknown");

  const summaryResult = await generateDocumentSummary(
    doc.file_name,
    effectiveText,
    doc.detected_language,
    script,
    lovableApiKey
  );

  const { error: writeSummaryError } = await supabase
    .from("documents")
    .update({
      summary: summaryResult.summary || null,
    })
    .eq("id", documentId);

  if (writeSummaryError) {
    throw new DocumentStageError(`Failed to persist summary: ${writeSummaryError.message}`, {
      code: "SUMMARY_WRITE_FAILED",
      classification: "retryable",
    });
  }

  return {
    document_id: documentId,
    summary_present: Boolean(summaryResult.summary),
    summary_length: summaryResult.summary?.length ?? 0,
    summary_model: summaryResult.model,
    summary_warning: summaryResult.warning ?? null,
  };
}

export async function buildSearchIndexStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const analysis = await loadDocumentAnalysisRow(supabase, documentId);

  if (!analysis?.extracted_text) {
    throw new DocumentStageError("Missing extracted_text for build_search_index", {
      code: "INDEX_MISSING_TEXT",
      classification: "terminal",
    });
  }

  const { error: stageError } = await supabase
    .from("documents")
    .update({ processing_status: "indexing" })
    .eq("id", documentId);

  if (stageError) {
    throw new DocumentStageError(`Failed to set indexing status: ${stageError.message}`, {
      code: "INDEX_STAGE_UPDATE_FAILED",
      classification: "retryable",
    });
  }

  const effectiveText = String(analysis.extracted_text);
  const stats = countStats(effectiveText);
  const searchText = normalizeForSearch(effectiveText, doc.file_name, doc.summary || undefined);
  const meta = toObject(analysis.metadata_json);

  const { error: upsertError } = await supabase.from("document_analysis").upsert(
    {
      document_id: documentId,
      user_id: doc.user_id,
      extracted_text: effectiveText.slice(0, 500000),
      normalized_search_text: searchText.slice(0, 500000),
      metadata_json: {
        ...meta,
        original_size: doc.file_size,
        mime_type: doc.mime_type,
        word_count: doc.word_count ?? stats.word_count,
        char_count: doc.char_count ?? stats.char_count,
        line_count: stats.line_count,
        detected_language: doc.detected_language,
        file_category: categorizeFile(doc.file_type),
      },
      ocr_used: false,
      indexed_at: new Date().toISOString(),
    },
    { onConflict: "document_id" }
  );

  if (upsertError) {
    throw new DocumentStageError(`Failed to persist search index payload: ${upsertError.message}`, {
      code: "INDEX_UPSERT_FAILED",
      classification: "retryable",
    });
  }

  return {
    document_id: documentId,
    indexed: true,
    normalized_text_length: searchText.length,
  };
}

export async function chunkTextStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);
  const analysis = await loadDocumentAnalysisRow(supabase, documentId);

  if (!analysis?.extracted_text) {
    throw new DocumentStageError("Missing extracted_text for chunking", {
      code: "CHUNK_TEXT_MISSING_TEXT",
      classification: "terminal",
    });
  }

  const { error: stageError } = await supabase
    .from("documents")
    .update({ processing_status: "chunking" })
    .eq("id", documentId);

  if (stageError) {
    throw new DocumentStageError(`Failed to set chunking status: ${stageError.message}`, {
      code: "CHUNK_STAGE_UPDATE_FAILED",
      classification: "retryable",
    });
  }

  const chunks = chunkText(String(analysis.extracted_text));
  const avgChunkSizeEstimate =
    chunks.length > 0
      ? Math.round(
          chunks.reduce((acc, c) => acc + estimateTokenCount(c.chunk_text), 0) /
            chunks.length
        )
      : 0;

  await supabase.from("document_chunks").delete().eq("document_id", documentId);

  if (chunks.length > 0) {
    const meta = toObject(analysis.metadata_json);
    const chunkRows = chunks.map((c) => ({
      document_id: documentId,
      user_id: doc.user_id,
      project_id: doc.project_id || null,
      chat_id: doc.chat_id || null,
      notebook_id: doc.notebook_id || null,
      chunk_index: c.chunk_index,
      chunk_text: c.chunk_text,
      embedding: null,
      token_count: estimateTokenCount(c.chunk_text),
      language: doc.detected_language,
      metadata_json: {
        extraction_method: meta.extraction_method ?? null,
        quality_score: meta.quality_score ?? null,
      },
    }));

    for (let i = 0; i < chunkRows.length; i += 50) {
      const batch = chunkRows.slice(i, i + 50);
      const { error: insertErr } = await supabase.from("document_chunks").insert(batch);
      if (insertErr) {
        throw new DocumentStageError(`Failed to persist chunk batch: ${insertErr.message}`, {
          code: "CHUNK_INSERT_FAILED",
          classification: "retryable",
        });
      }
    }
  }

  return {
    document_id: documentId,
    chunk_count: chunks.length,
    avg_chunk_size_estimate: avgChunkSizeEstimate,
  };
}

export async function generateChunkEmbeddingsStage(
  supabase: SupabaseClient,
  documentId: string
): Promise<Record<string, unknown>> {
  const { error: stageError } = await supabase
    .from("documents")
    .update({ processing_status: "generating_embeddings" })
    .eq("id", documentId);

  if (stageError) {
    throw new DocumentStageError(`Failed to set generating_embeddings status: ${stageError.message}`, {
      code: "EMBED_STAGE_UPDATE_FAILED",
      classification: "retryable",
    });
  }

  const { data: chunks, error: loadChunksError } = await supabase
    .from("document_chunks")
    .select("id, chunk_text")
    .eq("document_id", documentId)
    .order("chunk_index", { ascending: true });

  if (loadChunksError) {
    throw new DocumentStageError(`Failed to load chunks for embeddings: ${loadChunksError.message}`, {
      code: "EMBED_LOAD_CHUNKS_FAILED",
      classification: "retryable",
    });
  }

  const rows = chunks ?? [];
  if (rows.length === 0) {
    return {
      document_id: documentId,
      chunk_count: 0,
      embedded_count: 0,
      coverage_percent: 0,
    };
  }

  const embeddings = generateEmbeddingsLocal(rows.map((r) => String(r.chunk_text ?? "")));
  let embeddedCount = 0;

  const EMBEDDING_UPDATE_BATCH = 25;
  for (let i = 0; i < rows.length; i += EMBEDDING_UPDATE_BATCH) {
    const batchRows = rows.slice(i, i + EMBEDDING_UPDATE_BATCH);

    const batchResults = await Promise.all(
      batchRows.map(async (row, offset) => {
        const embedding = embeddings[i + offset];
        if (!embedding) return false;

        const { error: updateErr } = await supabase
          .from("document_chunks")
          .update({ embedding: JSON.stringify(embedding) })
          .eq("id", row.id);

        if (updateErr) {
          console.warn(`Failed to persist embedding for chunk ${row.id}: ${updateErr.message}`);
          return false;
        }

        return true;
      })
    );

    embeddedCount += batchResults.filter(Boolean).length;
  }

  if (rows.length > 0 && embeddedCount === 0) {
    await supabase
      .from("documents")
      .update({
        processing_status: "failed",
        processing_error: "Chunking succeeded but embedding generation failed for all chunks",
      })
      .eq("id", documentId);

    throw new DocumentStageError("Embedding generation failed for all chunks", {
      code: "EMBED_ALL_FAILED",
      classification: "terminal",
      details: { chunk_count: rows.length },
    });
  }

  const coverage = rows.length > 0 ? Math.round((embeddedCount / rows.length) * 100) : 0;

  return {
    document_id: documentId,
    chunk_count: rows.length,
    embedded_count: embeddedCount,
    coverage_percent: coverage,
  };
}

export async function generateChunkQuestionsStage(
  supabase: SupabaseClient,
  documentId: string,
  lovableApiKey?: string | null
): Promise<Record<string, unknown>> {
  await supabase
    .from("documents")
    .update({ processing_status: "generating_chunk_questions" })
    .eq("id", documentId);

  const doc = await loadDocumentRow(supabase, documentId);

  const { data: chunks, error: chunkError } = await supabase
    .from("document_chunks")
    .select("id, chunk_index, chunk_text")
    .eq("document_id", documentId)
    .order("chunk_index", { ascending: true });

  if (chunkError) {
    return {
      document_id: documentId,
      question_count: 0,
      embedded_question_count: 0,
      warning: `Failed to load chunks for question generation: ${chunkError.message}`,
    };
  }

  const chunkRows = chunks ?? [];

  await supabase
    .from("document_chunk_questions")
    .delete()
    .eq("document_id", documentId);

  if (chunkRows.length === 0 || !lovableApiKey) {
    return {
      document_id: documentId,
      question_count: 0,
      embedded_question_count: 0,
      warning: chunkRows.length === 0
        ? "No chunks available for question generation"
        : "LOVABLE_API_KEY is missing",
    };
  }

  const QUESTION_BATCH_SIZE = 5;
  const allQuestionRows: any[] = [];

  for (let batchStart = 0; batchStart < chunkRows.length; batchStart += QUESTION_BATCH_SIZE) {
    const batch = chunkRows.slice(batchStart, batchStart + QUESTION_BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (chunk) => {
        try {
          const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${lovableApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-lite",
              messages: [
                {
                  role: "system",
                  content: `You generate short questions that can be answered ONLY from the given text passage. Rules:\n- Generate exactly 1 to 3 questions.\n- Generate exactly 1 to 2 questions.\n- Each question must be answerable from this passage alone.\n- Do not generate speculative, cross-reference, or opinion questions.\n- Keep questions concise (under 20 words each).\n- Return ONLY a JSON array of strings, e.g. ["Question 1?", "Question 2?"]\n- No markdown, no explanation, no numbering outside the array.`,
                },
                {
                  role: "user",
                  content: `Generate grounded questions for this passage:\n\n${String(chunk.chunk_text || "").slice(0, 3000)}`,
                },
              ],
            }),
          });

          if (!aiResp.ok) return [];

          const aiData = await aiResp.json();
          const raw = aiData.choices?.[0]?.message?.content || "";
          const jsonMatch = raw.match(/\[[\s\S]*\]/);
          if (!jsonMatch) return [];

          let questions: string[];
          try {
            questions = JSON.parse(jsonMatch[0]);
          } catch {
            return [];
          }

          if (!Array.isArray(questions)) return [];

          return questions
            .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
            .slice(0, 2)
            .map((questionText, idx) => ({
              chunk_id: chunk.id,
              document_id: documentId,
              user_id: doc.user_id,
              project_id: doc.project_id || null,
              chat_id: doc.chat_id || null,
              notebook_id: doc.notebook_id || null,
              question_text: questionText.trim(),
              position: idx + 1,
              embedding: JSON.stringify(localEmbedding(questionText)),
              generation_model: "google/gemini-2.5-flash-lite",
              embedding_version: "local-hash-v1",
              is_grounded: true,
            }));
        } catch {
          return [];
        }
      })
    );

    for (const result of batchResults) {
      allQuestionRows.push(...result);
    }
  }

  if (allQuestionRows.length > 0) {
    for (let i = 0; i < allQuestionRows.length; i += 50) {
      const batch = allQuestionRows.slice(i, i + 50);
      const { error: insertErr } = await supabase
        .from("document_chunk_questions")
        .insert(batch);

      if (insertErr) {
        console.warn(`Question insert batch failed: ${insertErr.message}`);
      }
    }
  }

  const embeddedQuestionCount = allQuestionRows.filter((row) => row.embedding != null).length;
  const chunkIds = new Set(allQuestionRows.map((row) => row.chunk_id));

  return {
    document_id: documentId,
    question_count: allQuestionRows.length,
    embedded_question_count: embeddedQuestionCount,
    chunks_with_questions_count: chunkIds.size,
  };
}

export async function finalizeDocumentStage(
  supabase: SupabaseClient,
  documentId: string,
  requestedFinalStatus?: string,
  requestedError?: string | null
): Promise<Record<string, unknown>> {
  const doc = await loadDocumentRow(supabase, documentId);

  const finalStatus = requestedFinalStatus
    ? requestedFinalStatus
    : doc.processing_status === "failed" || Boolean(doc.processing_error)
      ? "failed"
      : "completed";

  if (finalStatus === "failed") {
    const { error } = await supabase
      .from("documents")
      .update({
        processing_status: "failed",
        processing_error: requestedError ?? doc.processing_error ?? "Document processing failed",
      })
      .eq("id", documentId);

    if (error) {
      throw new DocumentStageError(`Failed to persist failed final state: ${error.message}`, {
        code: "FINALIZE_FAILED_WRITE_FAILED",
        classification: "retryable",
      });
    }

    return {
      document_id: documentId,
      final_status: "failed",
      finalized_at: new Date().toISOString(),
    };
  }

  const { error } = await supabase
    .from("documents")
    .update({
      processing_status: "completed",
      processing_error: null,
    })
    .eq("id", documentId);

  if (error) {
    throw new DocumentStageError(`Failed to persist completed final state: ${error.message}`, {
      code: "FINALIZE_COMPLETED_WRITE_FAILED",
      classification: "retryable",
    });
  }

  return {
    document_id: documentId,
    final_status: "completed",
    finalized_at: new Date().toISOString(),
  };
}
