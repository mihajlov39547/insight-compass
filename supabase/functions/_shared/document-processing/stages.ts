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

  for (let i = 0; i < rows.length; i++) {
    const embedding = embeddings[i];
    if (!embedding) continue;

    const { error: updateErr } = await supabase
      .from("document_chunks")
      .update({ embedding: JSON.stringify(embedding) })
      .eq("id", rows[i].id);

    if (updateErr) {
      console.warn(`Failed to persist embedding for chunk ${rows[i].id}: ${updateErr.message}`);
      continue;
    }

    embeddedCount += 1;
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
