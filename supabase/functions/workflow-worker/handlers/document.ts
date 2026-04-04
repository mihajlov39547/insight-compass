// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import type { HandlerExecutionInput } from "../contracts.ts";
import type { HandlerOutput } from "../handler-interface.ts";
import {
  DocumentStageError,
  prepareRunStage,
  loadSourceStage,
  detectFileTypeStage,
  inspectPdfTextLayerStage,
  extractPdfTextStage,
  extractDocxTextStage,
  extractDocTextStage,
  extractSpreadsheetTextStage,
  extractPresentationTextStage,
  extractEmailTextStage,
  ocrPdfStage,
  ocrImageStage,
  extractImageMetadataStage,
  detectScannedDocumentStage,
  extractPlainTextLikeContentStage,
  normalizeTechnicalAnalysisOutputStage,
  persistAnalysisMetadataStage,
  computeFileFingerprintStage,
  extractTextStage,
  assessQualityStage,
  detectLanguageAndStatsStage,
  generateSummaryStage,
  buildSearchIndexStage,
  chunkTextStage,
  generateChunkEmbeddingsStage,
  generateChunkQuestionsStage,
  finalizeDocumentStage,
} from "../../_shared/document-processing/stages.ts";

function toObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function deriveMetadataPatchFromContext(
  activityKey: string,
  workflowContext: unknown
): Record<string, unknown> {
  const ctx = toObject(workflowContext);
  const warnings: string[] = [];

  const warningCandidates = [
    ctx.ocr_pdf_warning,
    ctx.ocr_image_warning,
    ctx.question_generation_warning,
    ctx.summary_warning,
    ctx.presentation_parser_warning,
    ctx.email_parser_warning,
  ];

  for (const candidate of warningCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      warnings.push(candidate.trim());
    }
  }

  return {
    file_type_category: ctx.normalized_file_category ?? null,
    pdf_text_status: ctx.pdf_text_status ?? null,
    extractor_selected:
      ctx.docx_extraction_method ??
      ctx.doc_extraction_method ??
      ctx.spreadsheet_extraction_method ??
      ctx.presentation_extraction_method ??
      ctx.email_extraction_method ??
      ctx.plain_text_extraction_method ??
      ctx.pdf_extraction_method ??
      ctx.extraction_method ??
      null,
    extractor_status:
      ctx.ocr_pdf_status ??
      ctx.ocr_image_status ??
      ctx.readable ??
      null,
    extracted_char_count:
      ctx.normalized_text_length ??
      ctx.pdf_extracted_text_length ??
      ctx.docx_extracted_text_length ??
      ctx.doc_extracted_text_length ??
      null,
    detected_language: ctx.detected_language ?? null,
    detected_script: ctx.detected_script ?? null,
    quality_score: ctx.text_quality_score ?? null,
    quality_reason: ctx.text_quality_reason ?? null,
    word_count: ctx.word_count ?? null,
    char_count: ctx.char_count ?? null,
    chunk_count: ctx.chunk_count ?? null,
    embeddings_generated: ctx.embeddings_generated ?? null,
    questions_generated: ctx.questions_generated ?? null,
    extraction_warnings: warnings,
    last_completed_stage: activityKey,
  };
}

function resolveDocumentId(input: HandlerExecutionInput): string | null {
  const payload = toObject(input.activity_input_payload);
  const fromPayload = payload.document_id ?? payload.documentId ?? payload.id;
  if (typeof fromPayload === "string" && fromPayload.trim()) {
    return fromPayload;
  }

  const fromContext = toObject(input.workflow_context).document_id;
  if (typeof fromContext === "string" && fromContext.trim()) {
    return fromContext;
  }

  return null;
}

function createServiceRoleClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    throw new DocumentStageError(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      {
        code: "MISSING_SUPABASE_ENV",
        classification: "terminal",
      }
    );
  }

  return createClient(supabaseUrl, serviceKey);
}

function normalizeFailure(error: unknown, fallbackCode: string) {
  if (error instanceof DocumentStageError) {
    return {
      classification: error.classification,
      message: error.message,
      code: error.code,
      details: error.details ?? null,
    };
  }

  if (error instanceof Error) {
    return {
      classification: "retryable",
      message: error.message,
      code: fallbackCode,
      details: null,
    };
  }

  return {
    classification: "retryable",
    message: "Unknown document stage error",
    code: fallbackCode,
    details: null,
  };
}

function toContextPatch(
  value: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const patch = toObject(value);
  return Object.keys(patch).length > 0 ? patch : undefined;
}

async function runStage(
  input: HandlerExecutionInput,
  stageKey: string,
  fallbackCode: string,
  runner: (supabase: ReturnType<typeof createServiceRoleClient>, documentId: string) => Promise<Record<string, unknown>>,
  options: {
    optionalNonFatal?: boolean;
    buildContextPatch?: (result: Record<string, unknown>) => Record<string, unknown> | undefined;
    buildWarningContextPatch?: (warning: {
      message: string;
      code: string;
      details: unknown;
    }) => Record<string, unknown> | undefined;
  } = {}
): Promise<HandlerOutput> {
  const documentId = resolveDocumentId(input);
  if (!documentId) {
    return {
      ok: false,
      error: {
        classification: "terminal",
        message: "activity_input_payload.document_id is required",
        code: "MISSING_DOCUMENT_ID",
        details: {
          activity_key: input.activity_key,
          handler_key: input.handler_key,
        },
      },
    };
  }

  try {
    const supabase = createServiceRoleClient();
    const result = await runner(supabase, documentId);
    return {
      ok: true,
      output_payload: {
        handler: stageKey,
        executed_at: new Date().toISOString(),
        document_id: documentId,
        ...toObject(result),
      },
      context_patch: toContextPatch(options.buildContextPatch?.(toObject(result))),
    };
  } catch (error) {
    const normalized = normalizeFailure(error, fallbackCode);

    if (options.optionalNonFatal) {
      return {
        ok: true,
        output_payload: {
          handler: stageKey,
          executed_at: new Date().toISOString(),
          document_id: documentId,
          warning: normalized.message,
          warning_code: normalized.code,
          warning_details: normalized.details,
          optional_non_fatal: true,
        },
        context_patch: toContextPatch(
          options.buildWarningContextPatch?.({
            message: normalized.message,
            code: normalized.code,
            details: normalized.details,
          })
        ),
      };
    }

    return {
      ok: false,
      error: normalized,
    };
  }
}

// Phase B durable-workflow handlers
// Note: Additional Phase extension handlers below are intentionally registered
// but not yet wired into active workflow definitions.

export async function documentPrepareRun(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.prepare_run",
    "DOCUMENT_PREPARE_RUN_FAILED",
    (supabase, documentId) => prepareRunStage(supabase, documentId)
  );
}

export async function documentLoadSource(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.load_source",
    "DOCUMENT_LOAD_SOURCE_FAILED",
    (supabase, documentId) => loadSourceStage(supabase, documentId)
  );
}

export async function documentExtractTextActivity(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.extract_text",
    "DOCUMENT_EXTRACT_TEXT_FAILED",
    (supabase, documentId) => extractTextStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        extraction_method: result.extraction_method ?? null,
        extraction_encoding: result.extraction_encoding ?? null,
        structural_noise_filtered: result.structural_noise_filtered ?? null,
        script_primary: result.script_primary ?? null,
        text_quality_score: result.quality_score ?? null,
        text_quality_reason: result.quality_reason ?? null,
        extractor_selected: result.extraction_method ?? null,
        extractor_status: result.readable === false ? "QUALITY_WARNING" : "COMPLETED",
        extracted_char_count: result.cleaned_text_length ?? result.raw_text_length ?? null,
        extraction_fallback_used: result.fallback_used ?? true,
      }),
    }
  );
}

export async function documentDetectFileType(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.detect_file_type",
    "DOCUMENT_DETECT_FILE_TYPE_FAILED",
    (supabase, documentId) => detectFileTypeStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        normalized_file_category: result.normalized_file_category ?? null,
        detected_from: result.detected_from ?? null,
      }),
    }
  );
}

export async function documentInspectPdfTextLayer(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.inspect_pdf_text_layer",
    "DOCUMENT_INSPECT_PDF_TEXT_LAYER_FAILED",
    (supabase, documentId) => inspectPdfTextLayerStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        pdf_text_status: result.pdf_text_status ?? null,
        page_count: result.page_count ?? null,
        pages_with_text_count: result.pages_with_text_count ?? null,
        pages_without_text_count: result.pages_without_text_count ?? null,
        inspection_warning: result.inspection_warning ?? null,
      }),
    }
  );
}

export async function documentExtractPdfText(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.extract_pdf_text",
    "DOCUMENT_EXTRACT_PDF_TEXT_FAILED",
    (supabase, documentId) => extractPdfTextStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        pdf_extraction_method: result.method ?? null,
        pdf_extracted_text_length: result.extracted_text_length ?? null,
        extractor_selected: result.method ?? null,
        extractor_status: result.extraction_status ?? null,
        extracted_char_count: result.extracted_text_length ?? null,
      }),
    }
  );
}

export async function documentExtractDocxText(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.extract_docx_text",
    "DOCUMENT_EXTRACT_DOCX_TEXT_FAILED",
    (supabase, documentId) => extractDocxTextStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        docx_extraction_method: result.method ?? null,
        docx_extracted_text_length: result.extracted_text_length ?? null,
        extractor_selected: result.method ?? null,
        extractor_status: result.extraction_status ?? null,
        extracted_char_count: result.extracted_text_length ?? null,
      }),
    }
  );
}

export async function documentExtractDocText(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.extract_doc_text",
    "DOCUMENT_EXTRACT_DOC_TEXT_FAILED",
    (supabase, documentId) => extractDocTextStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        doc_extraction_method: result.method ?? null,
        doc_extracted_text_length: result.extracted_text_length ?? null,
        extractor_selected: result.method ?? null,
        extractor_status: result.extraction_status ?? null,
        extracted_char_count: result.extracted_text_length ?? null,
      }),
    }
  );
}

export async function documentExtractSpreadsheetText(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.extract_spreadsheet_text",
    "DOCUMENT_EXTRACT_SPREADSHEET_TEXT_FAILED",
    (supabase, documentId) => extractSpreadsheetTextStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        spreadsheet_extraction_method: result.method ?? null,
        spreadsheet_sheet_count: result.sheet_count ?? null,
        extractor_selected: result.method ?? null,
        extractor_status: result.extraction_status ?? null,
        extracted_char_count: result.extracted_text_length ?? null,
      }),
    }
  );
}

export async function documentExtractPresentationText(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.extract_presentation_text",
    "DOCUMENT_EXTRACT_PRESENTATION_TEXT_FAILED",
    (supabase, documentId) => extractPresentationTextStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        presentation_extraction_method: result.method ?? null,
        presentation_support_status: result.support_status ?? null,
        presentation_type: result.presentation_type ?? null,
        presentation_slide_count: result.slide_count ?? null,
        presentation_notes_count: result.notes_count ?? null,
        extractor_selected: result.method ?? null,
        extractor_status: result.support_status ?? result.extraction_status ?? null,
        extracted_char_count: result.extracted_text_length ?? null,
        presentation_parser_warning: Array.isArray(result.parser_warnings) && result.parser_warnings.length > 0
          ? result.parser_warnings.join(" | ")
          : null,
      }),
    }
  );
}

export async function documentExtractEmailText(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.extract_email_text",
    "DOCUMENT_EXTRACT_EMAIL_TEXT_FAILED",
    (supabase, documentId) => extractEmailTextStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        email_extraction_method: result.method ?? null,
        email_support_status: result.support_status ?? null,
        email_subject: result.email_subject ?? null,
        extractor_selected: result.method ?? null,
        extractor_status: result.support_status ?? result.extraction_status ?? null,
        extracted_char_count: result.extracted_text_length ?? null,
        email_attachment_count: result.attachment_count ?? null,
        email_parser_warning: Array.isArray(result.parser_warnings) && result.parser_warnings.length > 0
          ? result.parser_warnings.join(" | ")
          : null,
      }),
    }
  );
}

export async function documentOcrPdf(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.ocr_pdf",
    "DOCUMENT_OCR_PDF_FAILED",
    (supabase, documentId) => ocrPdfStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        ocr_pdf_status: result.ocr_status ?? null,
        ocr_pdf_engine: result.ocr_engine ?? null,
        ocr_pdf_confidence: result.ocr_confidence ?? null,
        ocr_pdf_languages: result.ocr_languages ?? null,
        ocr_pdf_processed_pages: result.processed_page_count ?? null,
        extractor_selected: result.ocr_engine ?? null,
        extractor_status: result.ocr_status ?? null,
        extracted_char_count: result.extracted_text_length ?? null,
        ocr_pdf_fallback_used: result.ocr_fallback_used ?? null,
        ocr_pdf_warning: result.warning ?? null,
      }),
    }
  );
}

export async function documentOcrImage(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.ocr_image",
    "DOCUMENT_OCR_IMAGE_FAILED",
    (supabase, documentId) => ocrImageStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        ocr_image_status: result.ocr_status ?? null,
        ocr_image_engine: result.ocr_engine ?? null,
        ocr_image_confidence: result.ocr_confidence ?? null,
        ocr_image_languages: result.ocr_languages ?? null,
        extractor_selected: result.ocr_engine ?? null,
        extractor_status: result.ocr_status ?? null,
        extracted_char_count: result.extracted_text_length ?? null,
        ocr_image_warning: result.warning ?? null,
      }),
    }
  );
}

export async function documentExtractImageMetadata(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.extract_image_metadata",
    "DOCUMENT_EXTRACT_IMAGE_METADATA_FAILED",
    (supabase, documentId) => extractImageMetadataStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        image_width: result.image_width ?? null,
        image_height: result.image_height ?? null,
        image_format: result.image_format ?? null,
      }),
    }
  );
}

export async function documentDetectScannedDocument(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.detect_scanned_document",
    "DOCUMENT_DETECT_SCANNED_DOCUMENT_FAILED",
    (supabase, documentId) => detectScannedDocumentStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        scanned_document_status: result.scanned_document_status ?? null,
        likely_scanned: result.likely_scanned ?? null,
      }),
    }
  );
}

export async function documentExtractPlainTextLikeContent(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.extract_plain_text_like_content",
    "DOCUMENT_EXTRACT_PLAIN_TEXT_LIKE_CONTENT_FAILED",
    (supabase, documentId) => extractPlainTextLikeContentStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        plain_text_extraction_method: result.method ?? null,
        plain_text_word_count: result.word_count ?? null,
        extractor_selected: result.method ?? null,
        extractor_status: result.extraction_status ?? null,
        extracted_char_count: result.extracted_text_length ?? null,
      }),
    }
  );
}

export async function documentNormalizeTechnicalAnalysisOutput(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  const payload = toObject(input.activity_input_payload);
  const rawInput = toObject(payload.raw_input ?? payload.input ?? {});

  return runStage(
    input,
    "document.normalize_technical_analysis_output",
    "DOCUMENT_NORMALIZE_TECHNICAL_ANALYSIS_OUTPUT_FAILED",
    (supabase, documentId) =>
      normalizeTechnicalAnalysisOutputStage(supabase, documentId, rawInput),
    {
      buildContextPatch: (result) => ({
        normalized_text_length: result.normalized_text_length ?? null,
      }),
    }
  );
}

export async function documentPersistAnalysisMetadata(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  const payload = toObject(input.activity_input_payload);
  const metadataPatch = {
    ...deriveMetadataPatchFromContext(input.activity_key, input.workflow_context),
    ...toObject(payload.metadata_patch ?? payload.patch ?? {}),
  };

  return runStage(
    input,
    "document.persist_analysis_metadata",
    "DOCUMENT_PERSIST_ANALYSIS_METADATA_FAILED",
    (supabase, documentId) =>
      persistAnalysisMetadataStage(supabase, documentId, metadataPatch),
    {
      buildContextPatch: (result) => ({
        metadata_keys_written_count: Array.isArray(result.metadata_keys_written)
          ? result.metadata_keys_written.length
          : null,
        metadata_persisted_at: result.metadata_persisted_at ?? null,
      }),
    }
  );
}

export async function documentComputeFileFingerprint(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.compute_file_fingerprint",
    "DOCUMENT_COMPUTE_FILE_FINGERPRINT_FAILED",
    (supabase, documentId) => computeFileFingerprintStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        file_fingerprint_sha256: result.fingerprint_sha256 ?? null,
      }),
    }
  );
}

export async function documentAssessQuality(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.assess_quality",
    "DOCUMENT_ASSESS_QUALITY_FAILED",
    (supabase, documentId) => assessQualityStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        readable: result.readable ?? null,
        text_quality_score: result.quality_score ?? null,
        text_quality_reason: result.quality_reason ?? null,
      }),
    }
  );
}

export async function documentDetectLanguageAndStats(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.detect_language_and_stats",
    "DOCUMENT_DETECT_LANGUAGE_STATS_FAILED",
    (supabase, documentId) => detectLanguageAndStatsStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        detected_language: result.detected_language ?? null,
        detected_script: result.detected_script ?? null,
        language_confidence: result.language_confidence ?? null,
        word_count: result.word_count ?? null,
        char_count: result.char_count ?? null,
      }),
    }
  );
}

export async function documentGenerateSummary(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.generate_summary",
    "DOCUMENT_GENERATE_SUMMARY_FAILED",
    (supabase, documentId) =>
      generateSummaryStage(
        supabase,
        documentId,
        Deno.env.get("LOVABLE_API_KEY")
      ),
    {
      buildContextPatch: (result) => ({
        summary_present: result.summary_present ?? null,
        summary_length: result.summary_length ?? null,
        summary_warning: result.summary_warning ?? null,
      }),
    }
  );
}

export async function documentBuildSearchIndex(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.build_search_index",
    "DOCUMENT_BUILD_SEARCH_INDEX_FAILED",
    (supabase, documentId) => buildSearchIndexStage(supabase, documentId)
  );
}

export async function documentChunkText(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.chunk_text",
    "DOCUMENT_CHUNK_TEXT_FAILED",
    (supabase, documentId) => chunkTextStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        chunk_count: result.chunk_count ?? null,
        avg_chunk_size_estimate: result.avg_chunk_size_estimate ?? null,
      }),
    }
  );
}

export async function documentGenerateChunkEmbeddings(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.generate_chunk_embeddings",
    "DOCUMENT_GENERATE_CHUNK_EMBEDDINGS_FAILED",
    (supabase, documentId) => generateChunkEmbeddingsStage(supabase, documentId),
    {
      buildContextPatch: (result) => ({
        embeddings_generated: result.embedded_count ?? null,
        embeddings_expected: result.chunk_count ?? null,
        semantic_ready_candidate:
          typeof result.chunk_count === "number" &&
          typeof result.embedded_count === "number"
            ? result.chunk_count > 0 && result.chunk_count === result.embedded_count
            : null,
      }),
    }
  );
}

export async function documentGenerateChunkQuestions(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  return runStage(
    input,
    "document.generate_chunk_questions",
    "DOCUMENT_GENERATE_CHUNK_QUESTIONS_FAILED",
    (supabase, documentId) =>
      generateChunkQuestionsStage(
        supabase,
        documentId,
        Deno.env.get("LOVABLE_API_KEY")
      ),
    {
      optionalNonFatal: true,
      buildContextPatch: (result) => ({
        questions_generated: result.question_count ?? null,
        questions_embedded: result.embedded_question_count ?? null,
        question_generation_warning: result.warning ?? null,
      }),
      buildWarningContextPatch: (warning) => ({
        questions_generated: 0,
        questions_embedded: 0,
        question_generation_warning: warning.message,
        question_generation_warning_code: warning.code,
      }),
    }
  );
}

export async function documentFinalizeDocument(
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  const payload = toObject(input.activity_input_payload);
  const requestedFinalStatus =
    typeof payload.final_status === "string" ? payload.final_status : undefined;
  const requestedError =
    typeof payload.processing_error === "string" ? payload.processing_error : null;

  return runStage(
    input,
    "document.finalize_document",
    "DOCUMENT_FINALIZE_FAILED",
    (supabase, documentId) =>
      finalizeDocumentStage(
        supabase,
        documentId,
        requestedFinalStatus,
        requestedError
      ),
    {
      buildContextPatch: (result) => ({
        final_document_status: result.final_status ?? null,
        finalized_at: result.finalized_at ?? null,
      }),
    }
  );
}

// Backward-compatible aliases for existing placeholder keys

export async function documentLoad(input: HandlerExecutionInput): Promise<HandlerOutput> {
  return documentLoadSource(input);
}

export async function documentExtractText(input: HandlerExecutionInput): Promise<HandlerOutput> {
  return documentExtractTextActivity(input);
}

export async function documentChunk(input: HandlerExecutionInput): Promise<HandlerOutput> {
  return documentChunkText(input);
}

export async function documentSummarize(input: HandlerExecutionInput): Promise<HandlerOutput> {
  return documentGenerateSummary(input);
}

export async function documentFinalize(input: HandlerExecutionInput): Promise<HandlerOutput> {
  return documentFinalizeDocument(input);
}
