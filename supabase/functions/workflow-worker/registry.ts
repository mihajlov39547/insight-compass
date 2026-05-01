import type {
  HandlerDefinition,
  HandlerOutput,
} from "./handler-interface.ts";
import type { HandlerExecutionInput } from "./contracts.ts";
import { executeHandlerSafely } from "./handler-framework.ts";
import {
  debugNoop,
  debugEcho,
  debugDelay,
  debugAggregate,
  debugFailRetryable,
  debugFailTerminal,
  debugFailNTimesThenSucceed,
} from "./handlers/debug.ts";
import {
  documentPrepareRun,
  documentLoadSource,
  documentDetectFileType,
  documentInspectPdfTextLayer,
  documentExtractPdfText,
  documentExtractDocxText,
  documentExtractDocText,
  documentExtractSpreadsheetText,
  documentExtractPresentationText,
  documentExtractEmailText,
  documentOcrPdf,
  documentOcrImage,
  documentExtractImageMetadata,
  documentDetectScannedDocument,
  documentExtractPlainTextLikeContent,
  documentNormalizeTechnicalAnalysisOutput,
  documentPersistAnalysisMetadata,
  documentComputeFileFingerprint,
  documentExtractTextActivity,
  documentAssessQuality,
  documentDetectLanguageAndStats,
  documentGenerateSummary,
  documentBuildSearchIndex,
  documentChunkText,
  documentGenerateChunkEmbeddings,
  documentGenerateChunkQuestions,
  documentFinalizeDocument,
  documentLoad,
  documentChunk,
  documentSummarize,
  documentFinalize,
} from "./handlers/document.ts";
import {
  youtubeClassifyResource,
  youtubeFetchTranscript,
  youtubePersistTranscriptChunks,
  youtubeGenerateTranscriptChunkEmbeddings,
  youtubeGenerateTranscriptChunkQuestions,
  youtubeGenerateTranscriptQuestionEmbeddings,
  youtubeFinalizeResourceStatus,
} from "./handlers/youtube.ts";

/**
 * Global handler registry, keyed by handler_key.
 * Handlers are registered by category; each handler is a definition with metadata.
 */

const registry: Map<string, HandlerDefinition> = new Map();
let builtInsInitialized = false;

/**
 * Register a handler in the registry.
 */
export function registerHandler(definition: HandlerDefinition): void {
  registry.set(definition.key, definition);
}

/**
 * Retrieve a handler definition by key.
 */
export function getHandlerDefinition(key: string): HandlerDefinition | undefined {
  return registry.get(key);
}

/**
 * Dispatch handler execution by key, using the base execution wrapper.
 * Unknown keys produce a normalized terminal error.
 */
export async function dispatchHandler(
  handlerKey: string,
  input: HandlerExecutionInput
): Promise<HandlerOutput> {
  const definition = registry.get(handlerKey);

  if (!definition) {
    return {
      ok: false,
      error: {
        classification: "terminal",
        message: `Handler not found: ${handlerKey}`,
        code: "HANDLER_NOT_FOUND",
      },
    };
  }

  return executeHandlerSafely(
    definition.handler,
    input,
    definition.timeout_seconds
  );
}

/**
 * List all registered handlers (useful for debugging).
 */
export function listHandlers(): Array<{
  key: string;
  category: string;
  description: string;
}> {
  return Array.from(registry.values()).map((def) => ({
    key: def.key,
    category: def.category,
    description: def.description,
  }));
}

/**
 * Register all built-in handlers.
 */
export function initializeBuiltInHandlers(): void {
  if (builtInsInitialized) {
    return;
  }

  registerHandler({
    key: "debug.noop",
    category: "debug",
    timeout_seconds: 5,
    description: "No-op debug handler; always succeeds",
    handler: debugNoop,
  });

  registerHandler({
    key: "debug.echo",
    category: "debug",
    timeout_seconds: 5,
    description: "Echo debug handler; returns input payload and context keys",
    handler: debugEcho,
  });

  registerHandler({
    key: "debug.delay",
    category: "debug",
    timeout_seconds: 30,
    description:
      "Delay debug handler; waits for configurable duration from activity input",
    handler: debugDelay,
  });

  registerHandler({
    key: "debug.aggregate",
    category: "debug",
    timeout_seconds: 10,
    description:
      "Aggregate debug handler; returns fan-in/join-oriented output shape",
    handler: debugAggregate,
  });

  registerHandler({
    key: "debug.fail_retryable",
    category: "debug",
    timeout_seconds: 5,
    description: "Retryable failure debug handler; for testing retry behavior",
    handler: debugFailRetryable,
  });

  registerHandler({
    key: "debug.fail_terminal",
    category: "debug",
    timeout_seconds: 5,
    description: "Terminal failure debug handler; for testing failure paths",
    handler: debugFailTerminal,
  });

  registerHandler({
    key: "debug.fail_n_times_then_succeed",
    category: "debug",
    timeout_seconds: 5,
    description:
      "Retry test handler; fails retryably for N attempts then succeeds",
    handler: debugFailNTimesThenSucceed,
  });

  registerHandler({
    key: "document.prepare_run",
    category: "document",
    timeout_seconds: 10,
    description:
      "Initializes document processing run state and retry tracking",
    handler: documentPrepareRun,
  });

  registerHandler({
    key: "document.load_source",
    category: "document",
    timeout_seconds: 20,
    description: "Loads source file from storage and validates availability",
    handler: documentLoadSource,
  });

  registerHandler({
    key: "document.extract_text",
    category: "document",
    timeout_seconds: 90,
    description: "Extracts text and stores extraction diagnostics",
    handler: documentExtractTextActivity,
  });

  // Additional additive handlers prepared for future workflow wiring.
  registerHandler({
    key: "document.detect_file_type",
    category: "document",
    timeout_seconds: 20,
    description: "Detects normalized file category for orchestration decisions",
    handler: documentDetectFileType,
  });

  registerHandler({
    key: "document.inspect_pdf_text_layer",
    category: "document",
    timeout_seconds: 45,
    description: "Inspects PDF for selectable text versus likely scanned",
    handler: documentInspectPdfTextLayer,
  });

  registerHandler({
    key: "document.extract_pdf_text",
    category: "document",
    timeout_seconds: 90,
    description: "Performs non-AI PDF text extraction",
    handler: documentExtractPdfText,
  });

  registerHandler({
    key: "document.extract_docx_text",
    category: "document",
    timeout_seconds: 60,
    description: "Performs non-AI DOCX text extraction",
    handler: documentExtractDocxText,
  });

  registerHandler({
    key: "document.extract_doc_text",
    category: "document",
    timeout_seconds: 60,
    description: "Performs non-AI legacy DOC text extraction",
    handler: documentExtractDocText,
  });

  registerHandler({
    key: "document.extract_spreadsheet_text",
    category: "document",
    timeout_seconds: 60,
    description: "Extracts spreadsheet text/content for XLS/XLSX/CSV",
    handler: documentExtractSpreadsheetText,
  });

  registerHandler({
    key: "document.extract_presentation_text",
    category: "document",
    timeout_seconds: 60,
    description: "Extracts presentation text for PPTX (slides+notes) with explicit PPT support status",
    handler: documentExtractPresentationText,
  });

  registerHandler({
    key: "document.extract_email_text",
    category: "document",
    timeout_seconds: 45,
    description: "Extracts EML and MSG email fields with parser-normalized output",
    handler: documentExtractEmailText,
  });

  registerHandler({
    key: "document.ocr_pdf",
    category: "document",
    timeout_seconds: 120,
    description: "Parser-first PDF OCR: text-layer inspection, then selective Tesseract.js OCR with optional fallback",
    handler: documentOcrPdf,
  });

  registerHandler({
    key: "document.ocr_image",
    category: "document",
    timeout_seconds: 90,
    description: "OCR stage for images using Tesseract.js",
    handler: documentOcrImage,
  });

  registerHandler({
    key: "document.extract_image_metadata",
    category: "document",
    timeout_seconds: 20,
    description: "Extracts image dimensions and format metadata",
    handler: documentExtractImageMetadata,
  });

  registerHandler({
    key: "document.detect_scanned_document",
    category: "document",
    timeout_seconds: 30,
    description: "Detects likely scanned PDFs from text-layer inspection",
    handler: documentDetectScannedDocument,
  });

  registerHandler({
    key: "document.extract_plain_text_like_content",
    category: "document",
    timeout_seconds: 30,
    description: "Extracts text from plain-text-like formats (txt/md/json/xml/csv)",
    handler: documentExtractPlainTextLikeContent,
  });

  registerHandler({
    key: "document.normalize_technical_analysis_output",
    category: "document",
    timeout_seconds: 30,
    description: "Normalizes technical analysis output for downstream compatibility",
    handler: documentNormalizeTechnicalAnalysisOutput,
  });

  registerHandler({
    key: "document.persist_analysis_metadata",
    category: "document",
    timeout_seconds: 30,
    description: "Persists additive technical metadata patch into document_analysis",
    handler: documentPersistAnalysisMetadata,
  });

  registerHandler({
    key: "document.compute_file_fingerprint",
    category: "document",
    timeout_seconds: 45,
    description: "Computes SHA-256 file fingerprint for diagnostics and future dedup",
    handler: documentComputeFileFingerprint,
  });

  registerHandler({
    key: "document.assess_quality",
    category: "document",
    timeout_seconds: 20,
    description: "Applies extraction readability quality gate",
    handler: documentAssessQuality,
  });

  registerHandler({
    key: "document.detect_language_and_stats",
    category: "document",
    timeout_seconds: 30,
    description: "Detects language/script and persists word/character counts",
    handler: documentDetectLanguageAndStats,
  });

  registerHandler({
    key: "document.generate_summary",
    category: "document",
    timeout_seconds: 45,
    description: "Generates and persists document summary with soft-failure semantics",
    handler: documentGenerateSummary,
  });

  registerHandler({
    key: "document.build_search_index",
    category: "document",
    timeout_seconds: 30,
    description: "Persists normalized search text and indexing metadata",
    handler: documentBuildSearchIndex,
  });

  registerHandler({
    key: "document.chunk_text",
    category: "document",
    timeout_seconds: 30,
    description: "Creates document chunks and token metadata",
    handler: documentChunkText,
  });

  registerHandler({
    key: "document.generate_chunk_embeddings",
    category: "document",
    timeout_seconds: 60,
    description: "Generates and persists local chunk embeddings",
    handler: documentGenerateChunkEmbeddings,
  });

  registerHandler({
    key: "document.generate_chunk_questions",
    category: "document",
    timeout_seconds: 120,
    description: "Generates grounded chunk questions (optional/non-fatal enrichment)",
    handler: documentGenerateChunkQuestions,
  });

  registerHandler({
    key: "document.finalize_document",
    category: "document",
    timeout_seconds: 15,
    description: "Applies final document status for workflow-driven processing",
    handler: documentFinalizeDocument,
  });

  // Legacy aliases retained for compatibility with older definitions/tests.
  registerHandler({
    key: "document.load",
    category: "document",
    timeout_seconds: 20,
    description: "Legacy alias of document.load_source",
    handler: documentLoad,
  });

  registerHandler({
    key: "document.chunk",
    category: "document",
    timeout_seconds: 30,
    description: "Legacy alias of document.chunk_text",
    handler: documentChunk,
  });

  registerHandler({
    key: "document.summarize",
    category: "document",
    timeout_seconds: 45,
    description: "Legacy alias of document.generate_summary",
    handler: documentSummarize,
  });

  registerHandler({
    key: "document.finalize",
    category: "document",
    timeout_seconds: 15,
    description: "Legacy alias of document.finalize_document",
    handler: documentFinalize,
  });

  // ===== YouTube processing (Phase 2 — real handlers) =====
  registerHandler({
    key: "youtube.classify_resource",
    category: "youtube",
    timeout_seconds: 10,
    description: "Validate provider and canonicalize YouTube video ID",
    handler: youtubeClassifyResource,
  });
  registerHandler({
    key: "youtube.fetch_transcript",
    category: "youtube",
    timeout_seconds: 60,
    description: "Fetch transcript via SerpApi with fallback strategies",
    handler: youtubeFetchTranscript,
  });
  registerHandler({
    key: "youtube.persist_transcript_chunks",
    category: "youtube",
    timeout_seconds: 45,
    description: "Chunk transcript and write to link_transcript_chunks",
    handler: youtubePersistTranscriptChunks,
  });
  registerHandler({
    key: "youtube.generate_transcript_chunk_embeddings",
    category: "youtube",
    timeout_seconds: 90,
    description: "Generate local embeddings for transcript chunks",
    handler: youtubeGenerateTranscriptChunkEmbeddings,
  });
  registerHandler({
    key: "youtube.generate_transcript_chunk_questions",
    category: "youtube",
    timeout_seconds: 120,
    description: "Generate grounded questions for transcript chunks",
    handler: youtubeGenerateTranscriptChunkQuestions,
  });
  registerHandler({
    key: "youtube.generate_transcript_question_embeddings",
    category: "youtube",
    timeout_seconds: 90,
    description: "Generate local embeddings for transcript questions",
    handler: youtubeGenerateTranscriptQuestionEmbeddings,
  });
  registerHandler({
    key: "youtube.finalize_resource_status",
    category: "youtube",
    timeout_seconds: 30,
    description: "Generate summary and finalize transcript_status to ready",
    handler: youtubeFinalizeResourceStatus,
  });

  builtInsInitialized = true;
}
