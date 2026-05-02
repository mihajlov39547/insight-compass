// @ts-nocheck
/**
 * YouTube processing workflow handlers — Phase 2.
 *
 * Ports logic from supabase/functions/youtube-transcript-worker/ into
 * the workflow engine handler interface.  Each handler is a self-contained
 * step that communicates with the next via `context_patch`.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import type { HandlerExecutionInput, JsonObject } from "../contracts.ts";
import type { HandlerOutput } from "../handler-interface.ts";
import { fetchTranscriptForVideo } from "../../_shared/youtube/transcript-fetcher.ts";
import { buildTranscriptChunks } from "../../_shared/youtube/chunk-persistence.ts";
import { generateEmbeddingsLocal, localEmbedding } from "../../_shared/document-processing/embeddings.ts";
import { generateDocumentSummary } from "../../_shared/document-processing/summarization.ts";
import { getModelForTask } from "../../_shared/ai/task-model-config.ts";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createServiceRoleClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw Object.assign(new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"), {
      classification: "terminal",
    });
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function ctx(input: HandlerExecutionInput): JsonObject {
  return (typeof input.workflow_context === "object" && input.workflow_context !== null
    ? input.workflow_context
    : {}) as JsonObject;
}

function inp(input: HandlerExecutionInput): Record<string, unknown> {
  const p = input.activity_input_payload;
  return typeof p === "object" && p !== null && !Array.isArray(p)
    ? (p as Record<string, unknown>)
    : {};
}

function fail(
  classification: "retryable" | "terminal",
  message: string,
  category?: string,
  code?: string,
): HandlerOutput {
  return {
    ok: false,
    error: {
      classification,
      category: (category ?? "permanent") as any,
      message,
      code: code ?? "YOUTUBE_HANDLER_ERROR",
    },
  };
}

/**
 * Extract canonical YouTube video ID from URL or raw id.
 */
function extractVideoId(urlOrId: string): string | null {
  if (!urlOrId) return null;
  // Already looks like a video ID (11 chars, no slashes)
  if (/^[\w-]{11}$/.test(urlOrId)) return urlOrId;
  try {
    const u = new URL(urlOrId);
    const v = u.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    // youtu.be/XXXX
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      if (/^[\w-]{11}$/.test(id)) return id;
    }
    // /embed/XXXX or /v/XXXX
    const embedMatch = u.pathname.match(/\/(embed|v)\/([\w-]{11})/);
    if (embedMatch) return embedMatch[2];
  } catch { /* not a URL */ }
  return null;
}

/* ------------------------------------------------------------------ */
/*  2.1 — classify_resource                                            */
/* ------------------------------------------------------------------ */

export async function youtubeClassifyResource(
  input: HandlerExecutionInput,
): Promise<HandlerOutput> {
  const wCtx = ctx(input);
  const url = (wCtx.url as string) || "";
  const resourceLinkId = (wCtx.resource_link_id as string) || "";

  if (!resourceLinkId) {
    return fail("terminal", "Missing resource_link_id in workflow context", "validation", "MISSING_RESOURCE_LINK_ID");
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return fail("terminal", `Cannot extract YouTube video ID from: ${url}`, "validation", "INVALID_YOUTUBE_URL");
  }

  // Verify resource exists and is YouTube
  const supabase = createServiceRoleClient();
  const { data: link, error } = await supabase
    .from("resource_links")
    .select("id, provider, media_video_id, user_id, project_id, notebook_id")
    .eq("id", resourceLinkId)
    .maybeSingle();

  if (error || !link) {
    return fail("terminal", `Resource link not found: ${error?.message || "no row"}`, "validation", "RESOURCE_NOT_FOUND");
  }

  // Update media_video_id if not already set
  if (!link.media_video_id || link.media_video_id !== videoId) {
    await supabase
      .from("resource_links")
      .update({ media_video_id: videoId, transcript_status: "processing" })
      .eq("id", resourceLinkId);
  } else {
    await supabase
      .from("resource_links")
      .update({ transcript_status: "processing" })
      .eq("id", resourceLinkId);
  }

  return {
    ok: true,
    output_payload: {
      video_id: videoId,
      resource_link_id: resourceLinkId,
      provider: link.provider,
    },
    context_patch: {
      video_id: videoId,
      resource_link_id: resourceLinkId,
      user_id: link.user_id,
      project_id: link.project_id || null,
      notebook_id: link.notebook_id || null,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  2.2 — fetch_transcript                                             */
/* ------------------------------------------------------------------ */

export async function youtubeFetchTranscript(
  input: HandlerExecutionInput,
): Promise<HandlerOutput> {
  const wCtx = ctx(input);
  const videoId = wCtx.video_id as string;
  const resourceLinkId = wCtx.resource_link_id as string;

  if (!videoId) return fail("terminal", "No video_id in context", "dependency_input", "MISSING_VIDEO_ID");

  try {
    const result = await fetchTranscriptForVideo(videoId);

    // Persist title metadata
    const supabase = createServiceRoleClient();
    await persistVideoTitleMetadata(supabase, resourceLinkId, result.videoTitle, result.videoSubtitle);

    // Persist debug metadata on resource_links
    await persistTranscriptDebugMetadata(supabase, resourceLinkId, result.debug, {
      provider: providerFromWinningStrategy(result.debug?.winningStrategy ?? null),
      winning_strategy: result.debug?.winningStrategy ?? null,
    });

    return {
      ok: true,
      output_payload: {
        transcript_length: result.transcript.length,
        winning_strategy: result.debug?.winningStrategy ?? null,
        video_title: result.videoTitle ?? null,
        video_subtitle: result.videoSubtitle ?? null,
        language_code: result.debug?.serpapiLanguageCode ?? null,
      },
      context_patch: {
        transcript_text: result.transcript,
        video_title: result.videoTitle ?? null,
        video_subtitle: result.videoSubtitle ?? null,
        transcript_language: result.debug?.serpapiLanguageCode ?? null,
        winning_strategy: result.debug?.winningStrategy ?? null,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown transcript fetch error";
    const debugPayload = (err as any)?.debug || null;

    // Persist error debug even on failure
    try {
      const supabase = createServiceRoleClient();
      await persistTranscriptDebugMetadata(supabase, resourceLinkId, debugPayload, {
        provider: providerFromLastStage(debugPayload),
        last_provider_error: message,
        error: message,
      });
      await persistVideoTitleMetadata(supabase, resourceLinkId, debugPayload?.youtubeTitle, debugPayload?.youtubeSubtitle);
    } catch { /* best-effort */ }

    const isTransient = /timeout|ECONNRESET|fetch failed|AbortError/i.test(message);
    return fail(
      isTransient ? "retryable" : "terminal",
      message,
      isTransient ? "transient" : "permanent",
      "TRANSCRIPT_FETCH_FAILED",
    );
  }
}

/* ------------------------------------------------------------------ */
/*  2.3 — persist_transcript_chunks                                    */
/* ------------------------------------------------------------------ */

export async function youtubePersistTranscriptChunks(
  input: HandlerExecutionInput,
): Promise<HandlerOutput> {
  const wCtx = ctx(input);
  const transcriptText = wCtx.transcript_text as string;
  const resourceLinkId = wCtx.resource_link_id as string;
  const userId = wCtx.user_id as string;
  const projectId = wCtx.project_id as string | null;
  const notebookId = wCtx.notebook_id as string | null;

  if (!transcriptText) return fail("terminal", "No transcript_text in context", "dependency_input", "MISSING_TRANSCRIPT");

  const chunks = buildTranscriptChunks(transcriptText);
  if (chunks.length === 0) return fail("terminal", "Transcript is empty after chunking", "validation", "EMPTY_TRANSCRIPT");

  const supabase = createServiceRoleClient();

  // Clear existing chunks
  const { error: deleteError } = await supabase
    .from("link_transcript_chunks")
    .delete()
    .eq("resource_link_id", resourceLinkId);

  if (deleteError) {
    return fail("retryable", `Failed to clear existing chunks: ${deleteError.message}`, "transient", "CHUNK_DELETE_FAILED");
  }

  // Build rows (without embeddings — those come in next activity)
  const rows = chunks.map((chunk) => ({
    resource_link_id: resourceLinkId,
    user_id: userId,
    project_id: projectId,
    notebook_id: notebookId,
    chunk_index: chunk.chunk_index,
    chunk_text: chunk.chunk_text,
    embedding: null,
    token_count: chunk.token_count,
    metadata_json: {
      source: "youtube_transcript",
      worker: "workflow-worker",
    },
  }));

  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error: insertError } = await supabase
      .from("link_transcript_chunks")
      .insert(batch);
    if (insertError) {
      return fail("retryable", `Failed to persist chunk batch: ${insertError.message}`, "transient", "CHUNK_INSERT_FAILED");
    }
  }

  return {
    ok: true,
    output_payload: {
      chunk_count: chunks.length,
      total_tokens: chunks.reduce((sum, c) => sum + c.token_count, 0),
    },
    context_patch: {
      chunk_count: chunks.length,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  2.4 — generate_transcript_chunk_embeddings                         */
/* ------------------------------------------------------------------ */

export async function youtubeGenerateTranscriptChunkEmbeddings(
  input: HandlerExecutionInput,
): Promise<HandlerOutput> {
  const wCtx = ctx(input);
  const resourceLinkId = wCtx.resource_link_id as string;

  const supabase = createServiceRoleClient();

  const { data: chunks, error: fetchError } = await supabase
    .from("link_transcript_chunks")
    .select("id, chunk_text")
    .eq("resource_link_id", resourceLinkId)
    .is("embedding", null)
    .order("chunk_index", { ascending: true });

  if (fetchError) {
    return fail("retryable", `Failed to load chunks: ${fetchError.message}`, "transient", "CHUNK_LOAD_FAILED");
  }

  if (!chunks || chunks.length === 0) {
    return {
      ok: true,
      output_payload: { embedded_count: 0, message: "No chunks need embedding" },
    };
  }

  const texts = chunks.map((c: any) => c.chunk_text);
  const embeddings = generateEmbeddingsLocal(texts);

  let embeddedCount = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (!embeddings[i]) continue;
    const { error: updateError } = await supabase
      .from("link_transcript_chunks")
      .update({ embedding: JSON.stringify(embeddings[i]) })
      .eq("id", chunks[i].id);

    if (updateError) {
      console.warn(`[youtube.embeddings] Failed to update chunk ${chunks[i].id}: ${updateError.message}`);
    } else {
      embeddedCount++;
    }
  }

  return {
    ok: true,
    output_payload: {
      embedded_count: embeddedCount,
      total_chunks: chunks.length,
    },
    context_patch: {
      embedded_chunk_count: embeddedCount,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  2.5 — generate_transcript_chunk_questions                          */
/* ------------------------------------------------------------------ */

function buildTranscriptQuestionsLocal(chunkText: string): string[] {
  const normalized = chunkText.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const topic = normalized
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 7)
    .join(" ")
    .trim();

  if (!topic) return [];

  return [
    `What is discussed in this transcript segment about ${topic}?`,
    `Which key details are mentioned in this segment about ${topic}?`,
  ];
}

async function buildTranscriptQuestionsAI(chunkText: string, lovableApiKey: string): Promise<string[]> {
  const model = getModelForTask("transcript_question_generation");
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: `You generate short questions answerable only from the given transcript segment. Rules:\n- Generate 1 to 2 questions.\n- Questions must be grounded in the text only.\n- Keep each question under 20 words.\n- Return ONLY a JSON array of strings.`,
        },
        {
          role: "user",
          content: `Generate grounded questions for this transcript segment:\n\n${String(chunkText || "").slice(0, 3000)}`,
        },
      ],
    }),
  });

  if (!resp.ok) return [];
  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const questions = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(questions)) return [];
    return questions
      .filter((q: unknown): q is string => typeof q === "string" && (q as string).trim().length > 0)
      .map((q: string) => q.trim())
      .slice(0, 2);
  } catch {
    return [];
  }
}

export async function youtubeGenerateTranscriptChunkQuestions(
  input: HandlerExecutionInput,
): Promise<HandlerOutput> {
  const wCtx = ctx(input);
  const resourceLinkId = wCtx.resource_link_id as string;
  const userId = wCtx.user_id as string;
  const projectId = wCtx.project_id as string | null;
  const notebookId = wCtx.notebook_id as string | null;

  const supabase = createServiceRoleClient();

  // Load persisted chunks
  const { data: chunks, error: chunkError } = await supabase
    .from("link_transcript_chunks")
    .select("id, chunk_index, chunk_text")
    .eq("resource_link_id", resourceLinkId)
    .order("chunk_index", { ascending: true });

  if (chunkError) {
    return fail("retryable", `Failed to load chunks: ${chunkError.message}`, "transient", "CHUNK_LOAD_FAILED");
  }

  if (!chunks || chunks.length === 0) {
    return {
      ok: true,
      output_payload: { question_count: 0, message: "No chunks to generate questions for" },
    };
  }

  // Clear existing questions
  await supabase
    .from("link_transcript_chunk_questions")
    .delete()
    .eq("resource_link_id", resourceLinkId);

  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")?.trim() || "";
  const transcriptQuestionModel = getModelForTask("transcript_question_generation");
  const questionRows: any[] = [];

  for (const chunk of chunks) {
    let questions: string[] = [];

    if (lovableApiKey) {
      try {
        questions = await buildTranscriptQuestionsAI(chunk.chunk_text, lovableApiKey);
      } catch { /* fall through to local */ }
    }

    if (questions.length === 0) {
      questions = buildTranscriptQuestionsLocal(chunk.chunk_text);
    }

    questions.slice(0, 2).forEach((questionText, idx) => {
      questionRows.push({
        chunk_id: chunk.id,
        resource_link_id: resourceLinkId,
        user_id: userId,
        project_id: projectId,
        notebook_id: notebookId,
        question_text: questionText,
        position: idx + 1,
        embedding: null, // embeddings come in next activity
        generation_model: lovableApiKey ? transcriptQuestionModel : "local-template-v1",
        embedding_version: "local-hash-v1",
        is_grounded: true,
        metadata_json: {
          source: "youtube_transcript",
          worker: "workflow-worker",
        },
      });
    });
  }

  for (let i = 0; i < questionRows.length; i += 50) {
    const batch = questionRows.slice(i, i + 50);
    const { error: insertError } = await supabase
      .from("link_transcript_chunk_questions")
      .insert(batch);
    if (insertError) {
      return fail("retryable", `Failed to persist question batch: ${insertError.message}`, "transient", "QUESTION_INSERT_FAILED");
    }
  }

  return {
    ok: true,
    output_payload: {
      question_count: questionRows.length,
      chunk_count: chunks.length,
    },
    context_patch: {
      question_count: questionRows.length,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  2.6 — generate_transcript_question_embeddings                      */
/* ------------------------------------------------------------------ */

export async function youtubeGenerateTranscriptQuestionEmbeddings(
  input: HandlerExecutionInput,
): Promise<HandlerOutput> {
  const wCtx = ctx(input);
  const resourceLinkId = wCtx.resource_link_id as string;

  const supabase = createServiceRoleClient();

  const { data: questions, error: fetchError } = await supabase
    .from("link_transcript_chunk_questions")
    .select("id, question_text")
    .eq("resource_link_id", resourceLinkId)
    .is("embedding", null);

  if (fetchError) {
    return fail("retryable", `Failed to load questions: ${fetchError.message}`, "transient", "QUESTION_LOAD_FAILED");
  }

  if (!questions || questions.length === 0) {
    return {
      ok: true,
      output_payload: { embedded_count: 0, message: "No questions need embedding" },
    };
  }

  let embeddedCount = 0;
  for (const q of questions) {
    try {
      const embedding = localEmbedding(q.question_text);
      const { error: updateError } = await supabase
        .from("link_transcript_chunk_questions")
        .update({ embedding: JSON.stringify(embedding) })
        .eq("id", q.id);

      if (!updateError) embeddedCount++;
    } catch {
      console.warn(`[youtube.question_embeddings] Failed to embed question ${q.id}`);
    }
  }

  return {
    ok: true,
    output_payload: {
      embedded_count: embeddedCount,
      total_questions: questions.length,
    },
    context_patch: {
      embedded_question_count: embeddedCount,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  2.7 — finalize_resource_status                                     */
/* ------------------------------------------------------------------ */

export async function youtubeFinalizeResourceStatus(
  input: HandlerExecutionInput,
): Promise<HandlerOutput> {
  const wCtx = ctx(input);
  const resourceLinkId = wCtx.resource_link_id as string;
  const transcriptText = wCtx.transcript_text as string;
  const videoTitle = wCtx.video_title as string | null;
  const transcriptLanguage = wCtx.transcript_language as string | null;
  const chunkCount = (wCtx.chunk_count as number) || 0;
  const questionCount = (wCtx.question_count as number) || 0;
  const embeddedQuestionCount = (wCtx.embedded_question_count as number) || 0;

  const supabase = createServiceRoleClient();

  // Generate summary
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")?.trim() || null;
  let summary: string | null = null;
  let summaryModel: string | null = null;
  let summaryWarning: string | null = null;

  if (transcriptText && lovableApiKey) {
    try {
      const result = await generateDocumentSummary(
        videoTitle || "YouTube Transcript",
        transcriptText,
        transcriptLanguage,
        null,
        lovableApiKey,
      );
      summary = result.summary || null;
      summaryModel = result.model || null;
      summaryWarning = result.warning || null;
    } catch (err) {
      summaryWarning = err instanceof Error ? err.message : "Summary generation failed";
    }
  }

  // Persist final debug metadata
  await persistTranscriptDebugMetadata(supabase, resourceLinkId, null, {
    question_count: questionCount,
    embedded_question_count: embeddedQuestionCount,
    summary,
    summary_model: summaryModel,
    summary_warning: summaryWarning,
  });

  // Update resource_links status
  const { error: updateError } = await supabase
    .from("resource_links")
    .update({
      transcript_status: "ready",
      transcript_updated_at: new Date().toISOString(),
      transcript_error: null,
    })
    .eq("id", resourceLinkId);

  if (updateError) {
    return fail("retryable", `Failed to update resource status: ${updateError.message}`, "transient", "STATUS_UPDATE_FAILED");
  }

  return {
    ok: true,
    output_payload: {
      resource_link_id: resourceLinkId,
      transcript_status: "ready",
      chunk_count: chunkCount,
      question_count: questionCount,
      embedded_question_count: embeddedQuestionCount,
      summary_generated: !!summary,
      duration_hint: `Finalized at ${new Date().toISOString()}`,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Shared metadata helpers (ported from legacy worker)                */
/* ------------------------------------------------------------------ */

function providerFromWinningStrategy(winningStrategy: string | null): string {
  if (typeof winningStrategy === "string" && winningStrategy.startsWith("serpapi_")) {
    return "serpapi";
  }
  return "internal_fallback";
}

function providerFromLastStage(debugPayload: any): string {
  if (debugPayload?.serpapiAttempted) return "serpapi";
  const stages = Array.isArray(debugPayload?.stages) ? debugPayload.stages : [];
  const lastStage = stages.length > 0 ? stages[stages.length - 1]?.stage : null;
  if (typeof lastStage === "string" && lastStage.startsWith("serpapi")) return "serpapi";
  return "internal_fallback";
}

async function persistTranscriptDebugMetadata(
  supabase: any,
  resourceId: string,
  debugPayload: unknown,
  extraTranscriptFields: Record<string, unknown> = {},
) {
  const hasExtraFields = Object.keys(extraTranscriptFields).length > 0;
  if (!debugPayload && !hasExtraFields) return;

  try {
    const { data: linkRow } = await supabase
      .from("resource_links")
      .select("metadata")
      .eq("id", resourceId)
      .maybeSingle();

    const currentMetadata = linkRow?.metadata && typeof linkRow.metadata === "object" ? linkRow.metadata : {};
    const currentTranscript = typeof currentMetadata.transcript === "object" && currentMetadata.transcript !== null
      ? currentMetadata.transcript
      : {};

    const nextMetadata = {
      ...currentMetadata,
      transcript: {
        ...currentTranscript,
        ...extraTranscriptFields,
        ...(debugPayload ? { debug: debugPayload } : {}),
      },
    };

    await supabase
      .from("resource_links")
      .update({ metadata: nextMetadata })
      .eq("id", resourceId);
  } catch (err) {
    console.warn(`[youtube.metadata] Failed to persist debug: ${err}`);
  }
}

async function persistVideoTitleMetadata(
  supabase: any,
  resourceId: string,
  rawTitle?: string | null,
  rawSubtitle?: string | null,
) {
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  const subtitle = typeof rawSubtitle === "string" ? rawSubtitle.trim() : "";
  if (!title && !subtitle) return;

  try {
    const { data: currentRow } = await supabase
      .from("resource_links")
      .select("title, preview_title, media_channel_name, url, media_video_id")
      .eq("id", resourceId)
      .maybeSingle();

    const currentTitle = (currentRow?.title || "").trim();
    const currentPreviewTitle = (currentRow?.preview_title || "").trim();
    const currentSubtitle = (currentRow?.media_channel_name || "").trim();
    const currentUrl = (currentRow?.url || "").trim();
    const currentVideoId = (currentRow?.media_video_id || "").trim();

    const isGenericTitle = (value: string): boolean => {
      if (!value) return true;
      if (/^youtube$/i.test(value)) return true;
      if (/^youtube video\s+[\w-]+$/i.test(value)) return true;
      if (value === currentUrl) return true;
      if (currentVideoId && value === `YouTube video ${currentVideoId}`) return true;
      if (/^https?:\/\/www\.youtube\.com\/watch\?v=/i.test(value)) return true;
      return false;
    };

    const canReplaceTitle = isGenericTitle(currentTitle) || isGenericTitle(currentPreviewTitle);
    const canReplaceSubtitle = !currentSubtitle || /^youtube$/i.test(currentSubtitle);

    const updatePayload: Record<string, unknown> = {};
    if (title && canReplaceTitle) {
      updatePayload.title = title;
      updatePayload.preview_title = title;
    }
    if (subtitle && canReplaceSubtitle) {
      updatePayload.media_channel_name = subtitle;
    }

    if (Object.keys(updatePayload).length > 0) {
      await supabase.from("resource_links").update(updatePayload).eq("id", resourceId);
    }
  } catch (err) {
    console.warn(`[youtube.metadata] Failed to persist title: ${err}`);
  }
}
