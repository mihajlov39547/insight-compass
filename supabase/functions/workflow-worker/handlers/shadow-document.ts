// @ts-nocheck
/**
 * Shadow-mode document handlers.
 *
 * When a workflow runs in shadow_mode, these handlers are used instead of the
 * real document handlers. They operate in READ-ONLY mode:
 * - Read production data from documents/document_analysis/document_chunks tables
 * - Return captured snapshots as output_payload
 * - Do NOT write to any production tables
 * - Context patches flow normally through the workflow engine
 *
 * This ensures shadow workflows never interfere with production document state.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import type { HandlerExecutionInput } from "../contracts.ts";
import type { HandlerOutput } from "../handler-interface.ts";

function toObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveDocumentId(input: HandlerExecutionInput): string | null {
  const payload = toObject(input.activity_input_payload);
  const fromPayload = payload.document_id ?? payload.documentId ?? payload.id;
  if (typeof fromPayload === "string" && fromPayload.trim()) return fromPayload;
  const fromContext = toObject(input.workflow_context).document_id;
  if (typeof fromContext === "string" && fromContext.trim()) return fromContext;
  return null;
}

function createServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

/**
 * Generic shadow stage runner. Reads production state and returns a snapshot
 * without writing anything.
 */
async function shadowReadOnlyStage(
  input: HandlerExecutionInput,
  stageKey: string,
  reader: (supabase: any, documentId: string) => Promise<Record<string, unknown>>,
  contextPatchBuilder?: (result: Record<string, unknown>) => Record<string, unknown> | undefined
): Promise<HandlerOutput> {
  const documentId = resolveDocumentId(input);
  if (!documentId) {
    return {
      ok: false,
      error: {
        classification: "terminal",
        message: "document_id is required for shadow stage",
        code: "SHADOW_MISSING_DOCUMENT_ID",
      },
    };
  }

  try {
    const supabase = createServiceClient();
    const result = await reader(supabase, documentId);
    const patch = contextPatchBuilder?.(result);
    return {
      ok: true,
      output_payload: {
        handler: stageKey,
        shadow_mode: true,
        executed_at: new Date().toISOString(),
        document_id: documentId,
        ...result,
      },
      context_patch: patch && Object.keys(patch).length > 0 ? patch : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        classification: "retryable",
        message: error instanceof Error ? error.message : "Shadow stage error",
        code: "SHADOW_STAGE_ERROR",
      },
    };
  }
}

// ── Shadow handler implementations ──

export async function shadowPrepareRun(input: HandlerExecutionInput): Promise<HandlerOutput> {
  return shadowReadOnlyStage(input, "shadow.prepare_run", async (supabase, docId) => {
    const { data: doc } = await supabase
      .from("documents")
      .select("id, processing_status, retry_count")
      .eq("id", docId)
      .single();
    return {
      document_id: docId,
      status: "shadow_snapshot",
      processing_status: doc?.processing_status ?? "unknown",
      retry_count: doc?.retry_count ?? 0,
    };
  });
}

export async function shadowLoadSource(input: HandlerExecutionInput): Promise<HandlerOutput> {
  return shadowReadOnlyStage(input, "shadow.load_source", async (supabase, docId) => {
    const { data: doc } = await supabase
      .from("documents")
      .select("id, storage_path, mime_type, file_name, file_size")
      .eq("id", docId)
      .single();
    return {
      document_id: docId,
      source_available: Boolean(doc?.storage_path),
      content_length: doc?.file_size ?? 0,
      storage_path: doc?.storage_path ?? null,
      mime_type: doc?.mime_type ?? null,
      file_name: doc?.file_name ?? null,
    };
  });
}

export async function shadowExtractText(input: HandlerExecutionInput): Promise<HandlerOutput> {
  return shadowReadOnlyStage(
    input,
    "shadow.extract_text",
    async (supabase, docId) => {
      const { data: analysis } = await supabase
        .from("document_analysis")
        .select("extracted_text, metadata_json")
        .eq("document_id", docId)
        .maybeSingle();
      const meta = toObject(analysis?.metadata_json);
      return {
        document_id: docId,
        has_extracted_text: Boolean(analysis?.extracted_text),
        text_length: analysis?.extracted_text?.length ?? 0,
        extraction_method: meta.extraction_method ?? null,
        extraction_encoding: meta.extraction_encoding ?? null,
        structural_noise_filtered: meta.structural_noise_filtered ?? null,
        script_primary: meta.detected_script ?? null,
        quality_score: meta.quality_score ?? null,
        quality_reason: meta.quality_reason ?? null,
      };
    },
    (result) => ({
      extraction_method: result.extraction_method ?? null,
      extraction_encoding: result.extraction_encoding ?? null,
      structural_noise_filtered: result.structural_noise_filtered ?? null,
      script_primary: result.script_primary ?? null,
      text_quality_score: result.quality_score ?? null,
      text_quality_reason: result.quality_reason ?? null,
    })
  );
}

export async function shadowAssessQuality(input: HandlerExecutionInput): Promise<HandlerOutput> {
  return shadowReadOnlyStage(
    input,
    "shadow.assess_quality",
    async (supabase, docId) => {
      const { data: analysis } = await supabase
        .from("document_analysis")
        .select("metadata_json")
        .eq("document_id", docId)
        .maybeSingle();
      const meta = toObject(analysis?.metadata_json);
      return {
        document_id: docId,
        readable: meta.extraction_readable ?? null,
        quality_score: meta.quality_score ?? null,
        quality_reason: meta.quality_reason ?? null,
      };
    },
    (result) => ({
      readable: result.readable ?? null,
      text_quality_score: result.quality_score ?? null,
      text_quality_reason: result.quality_reason ?? null,
    })
  );
}

export async function shadowDetectLanguageAndStats(input: HandlerExecutionInput): Promise<HandlerOutput> {
  return shadowReadOnlyStage(
    input,
    "shadow.detect_language_and_stats",
    async (supabase, docId) => {
      const { data: doc } = await supabase
        .from("documents")
        .select("detected_language, word_count, char_count")
        .eq("id", docId)
        .single();
      const { data: analysis } = await supabase
        .from("document_analysis")
        .select("metadata_json")
        .eq("document_id", docId)
        .maybeSingle();
      const meta = toObject(analysis?.metadata_json);
      return {
        document_id: docId,
        detected_language: doc?.detected_language ?? null,
        detected_script: meta.detected_script ?? null,
        language_confidence: meta.language_confidence ?? null,
        word_count: doc?.word_count ?? null,
        char_count: doc?.char_count ?? null,
      };
    },
    (result) => ({
      detected_language: result.detected_language ?? null,
      detected_script: result.detected_script ?? null,
      language_confidence: result.language_confidence ?? null,
      word_count: result.word_count ?? null,
      char_count: result.char_count ?? null,
    })
  );
}

export async function shadowGenerateSummary(input: HandlerExecutionInput): Promise<HandlerOutput> {
  return shadowReadOnlyStage(
    input,
    "shadow.generate_summary",
    async (supabase, docId) => {
      const { data: doc } = await supabase
        .from("documents")
        .select("summary")
        .eq("id", docId)
        .single();
      return {
        document_id: docId,
        summary_present: Boolean(doc?.summary),
        summary_length: doc?.summary?.length ?? 0,
      };
    },
    (result) => ({
      summary_present: result.summary_present ?? null,
      summary_length: result.summary_length ?? null,
    })
  );
}

export async function shadowBuildSearchIndex(input: HandlerExecutionInput): Promise<HandlerOutput> {
  return shadowReadOnlyStage(input, "shadow.build_search_index", async (supabase, docId) => {
    const { data: analysis } = await supabase
      .from("document_analysis")
      .select("normalized_search_text, indexed_at")
      .eq("document_id", docId)
      .maybeSingle();
    return {
      document_id: docId,
      has_search_index: Boolean(analysis?.normalized_search_text),
      indexed_at: analysis?.indexed_at ?? null,
    };
  });
}

export async function shadowChunkText(input: HandlerExecutionInput): Promise<HandlerOutput> {
  return shadowReadOnlyStage(
    input,
    "shadow.chunk_text",
    async (supabase, docId) => {
      const { count } = await supabase
        .from("document_chunks")
        .select("id", { count: "exact", head: true })
        .eq("document_id", docId);
      return {
        document_id: docId,
        chunk_count: count ?? 0,
      };
    },
    (result) => ({
      chunk_count: result.chunk_count ?? null,
    })
  );
}

export async function shadowGenerateChunkEmbeddings(input: HandlerExecutionInput): Promise<HandlerOutput> {
  return shadowReadOnlyStage(
    input,
    "shadow.generate_chunk_embeddings",
    async (supabase, docId) => {
      const { data: chunks } = await supabase
        .from("document_chunks")
        .select("id, embedding")
        .eq("document_id", docId);
      const total = chunks?.length ?? 0;
      const embedded = (chunks ?? []).filter((c: any) => c.embedding !== null).length;
      return {
        document_id: docId,
        chunk_count: total,
        embedded_count: embedded,
        semantic_ready: total > 0 && total === embedded,
      };
    },
    (result) => ({
      embeddings_generated: result.embedded_count ?? null,
      embeddings_expected: result.chunk_count ?? null,
      semantic_ready_candidate: result.semantic_ready ?? null,
    })
  );
}

export async function shadowGenerateChunkQuestions(input: HandlerExecutionInput): Promise<HandlerOutput> {
  return shadowReadOnlyStage(
    input,
    "shadow.generate_chunk_questions",
    async (supabase, docId) => {
      const { data: questions } = await supabase
        .from("document_chunk_questions")
        .select("id, embedding")
        .eq("document_id", docId);
      const total = questions?.length ?? 0;
      const embedded = (questions ?? []).filter((q: any) => q.embedding !== null).length;
      return {
        document_id: docId,
        question_count: total,
        embedded_question_count: embedded,
      };
    },
    (result) => ({
      questions_generated: result.question_count ?? null,
      questions_embedded: result.embedded_question_count ?? null,
    })
  );
}

export async function shadowFinalizeDocument(input: HandlerExecutionInput): Promise<HandlerOutput> {
  return shadowReadOnlyStage(
    input,
    "shadow.finalize_document",
    async (supabase, docId) => {
      const { data: doc } = await supabase
        .from("documents")
        .select("processing_status, processing_error")
        .eq("id", docId)
        .single();
      return {
        document_id: docId,
        final_status: doc?.processing_status ?? "unknown",
        processing_error: doc?.processing_error ?? null,
        finalized_at: new Date().toISOString(),
      };
    },
    (result) => ({
      final_document_status: result.final_status ?? null,
      finalized_at: result.finalized_at ?? null,
    })
  );
}
