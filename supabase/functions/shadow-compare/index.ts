// @ts-nocheck
/**
 * shadow-compare
 *
 * Non-production Edge Function that compares production document-processing
 * results with shadow workflow results for a given document.
 *
 * Usage:
 *   POST /functions/v1/shadow-compare
 *   Body: { "document_id": "uuid" }
 *
 * Returns a structured comparison report showing whether both paths produced
 * equivalent results. This function is read-only and does not modify any data.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing environment configuration" }, 500);
    }

    let body: { document_id?: string; workflow_run_id?: string };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON payload" }, 400);
    }

    const documentId = body.document_id;
    if (!documentId) {
      return jsonResponse({ error: "document_id is required" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // ── 1. Read production results ──

    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .select("id, file_name, file_type, mime_type, file_size, processing_status, processing_error, detected_language, summary, word_count, char_count, page_count, user_id, project_id")
      .eq("id", documentId)
      .maybeSingle();

    if (docErr || !doc) {
      return jsonResponse({ error: `Document not found: ${docErr?.message ?? "unknown"}` }, 404);
    }

    // Count production chunks, embeddings, questions
    const [chunkStats, questionStats] = await Promise.all([
      supabase
        .from("document_chunks")
        .select("id, embedding", { count: "exact" })
        .eq("document_id", documentId),
      supabase
        .from("document_chunk_questions")
        .select("id, embedding", { count: "exact" })
        .eq("document_id", documentId),
    ]);

    const productionChunkCount = chunkStats.count ?? 0;
    const productionEmbeddedChunkCount = (chunkStats.data ?? []).filter(
      (c: any) => c.embedding !== null
    ).length;
    const productionQuestionCount = questionStats.count ?? 0;
    const productionEmbeddedQuestionCount = (questionStats.data ?? []).filter(
      (q: any) => q.embedding !== null
    ).length;

    const productionResults = {
      processing_status: doc.processing_status,
      processing_error: doc.processing_error,
      detected_language: doc.detected_language,
      summary_present: Boolean(doc.summary),
      summary_length: doc.summary?.length ?? 0,
      word_count: doc.word_count,
      char_count: doc.char_count,
      chunk_count: productionChunkCount,
      embedded_chunk_count: productionEmbeddedChunkCount,
      question_count: productionQuestionCount,
      embedded_question_count: productionEmbeddedQuestionCount,
    };

    // ── 2. Find shadow workflow runs for this document ──

    let workflowRunId = body.workflow_run_id ?? null;

    if (!workflowRunId) {
      // Find the most recent shadow workflow run for this document
      const { data: shadowRuns } = await supabase
        .from("workflow_runs")
        .select("id, status, input_payload, created_at, completed_at")
        .eq("trigger_entity_type", "document")
        .eq("trigger_entity_id", documentId)
        .order("created_at", { ascending: false })
        .limit(5);

      const shadowRun = (shadowRuns ?? []).find(
        (r: any) =>
          typeof r.input_payload === "object" &&
          r.input_payload !== null &&
          (r.input_payload as any).shadow_mode === true
      );

      if (!shadowRun) {
        return jsonResponse({
          document_id: documentId,
          comparison_status: "no_shadow_run",
          production: productionResults,
          shadow: null,
          diff: null,
          message: "No shadow workflow run found for this document",
        });
      }

      workflowRunId = shadowRun.id;
    }

    // ── 3. Read shadow workflow results ──

    const { data: shadowRun } = await supabase
      .from("workflow_runs")
      .select("id, status, input_payload, context, output_payload, created_at, completed_at, failure_reason")
      .eq("id", workflowRunId)
      .single();

    if (!shadowRun) {
      return jsonResponse({ error: "Shadow workflow run not found" }, 404);
    }

    const { data: activityRuns } = await supabase
      .from("activity_runs")
      .select("id, activity_key, handler_key, status, output_payload, error_message, attempt_count, started_at, finished_at")
      .eq("workflow_run_id", workflowRunId)
      .order("created_at", { ascending: true });

    // Extract shadow results from activity output_payloads
    const shadowCtx = typeof shadowRun.context === "object" ? (shadowRun.context as any) : {};
    const shadowActivities = (activityRuns ?? []).map((ar: any) => ({
      activity_key: ar.activity_key,
      status: ar.status,
      attempt_count: ar.attempt_count,
      output_summary: ar.output_payload
        ? {
            handler: (ar.output_payload as any).handler,
            document_id: (ar.output_payload as any).document_id,
            ...(ar.output_payload as any),
          }
        : null,
      error_message: ar.error_message,
    }));

    const shadowResults = {
      workflow_run_id: workflowRunId,
      workflow_status: shadowRun.status,
      failure_reason: shadowRun.failure_reason,
      detected_language: shadowCtx.detected_language ?? null,
      summary_present: shadowCtx.summary_present ?? null,
      summary_length: shadowCtx.summary_length ?? null,
      word_count: shadowCtx.word_count ?? null,
      char_count: shadowCtx.char_count ?? null,
      chunk_count: shadowCtx.chunk_count ?? null,
      embeddings_generated: shadowCtx.embeddings_generated ?? null,
      questions_generated: shadowCtx.questions_generated ?? null,
      questions_embedded: shadowCtx.questions_embedded ?? null,
      activities: shadowActivities,
    };

    // ── 4. Generate diff ──

    const warnings: string[] = [];

    function compareField(
      field: string,
      production: unknown,
      shadow: unknown
    ): "match" | "mismatch" | "shadow_missing" {
      if (shadow === null || shadow === undefined) {
        warnings.push(`Shadow missing: ${field}`);
        return "shadow_missing";
      }
      if (production !== shadow) {
        warnings.push(`Mismatch on ${field}: production=${JSON.stringify(production)}, shadow=${JSON.stringify(shadow)}`);
        return "mismatch";
      }
      return "match";
    }

    const diff = {
      detected_language: compareField("detected_language", productionResults.detected_language, shadowResults.detected_language),
      summary_present: compareField("summary_present", productionResults.summary_present, shadowResults.summary_present),
      word_count: compareField("word_count", productionResults.word_count, shadowResults.word_count),
      char_count: compareField("char_count", productionResults.char_count, shadowResults.char_count),
      chunk_count: compareField("chunk_count", productionResults.chunk_count, shadowResults.chunk_count),
      completion_status: {
        production_completed: productionResults.processing_status === "completed",
        shadow_completed: shadowRun.status === "completed",
        both_completed:
          productionResults.processing_status === "completed" && shadowRun.status === "completed",
        both_failed:
          productionResults.processing_status === "failed" && shadowRun.status === "failed",
      },
    };

    const allMatch =
      Object.values(diff)
        .filter((v) => typeof v === "string")
        .every((v) => v === "match") && diff.completion_status.both_completed;

    return jsonResponse({
      document_id: documentId,
      comparison_status: allMatch ? "equivalent" : "divergent",
      production: productionResults,
      shadow: shadowResults,
      diff,
      warnings,
      generated_at: new Date().toISOString(),
      message: allMatch
        ? "Production and shadow paths produced equivalent results"
        : `Differences detected: ${warnings.join("; ")}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("shadow-compare error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
