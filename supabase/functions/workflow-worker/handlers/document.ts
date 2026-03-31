// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import type { HandlerExecutionInput } from "../contracts.ts";
import type { HandlerOutput } from "../handler-interface.ts";
import {
  DocumentStageError,
  prepareRunStage,
  loadSourceStage,
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
