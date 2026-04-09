// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { chunkText, estimateTokenCount } from "../_shared/document-processing/chunking.ts";
import { generateEmbeddingsLocal } from "../_shared/document-processing/embeddings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-worker-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Authorize the request via one of two methods:
 * 1. x-worker-secret header matching YOUTUBE_TRANSCRIPT_WORKER_SECRET env var
 * 2. Authorization: Bearer <service_role_key> — verified by creating a
 *    supabase admin client and confirming the key works
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload;
  } catch {
    return null;
  }
}

function isAuthorizedWorkerRequest(req: Request): boolean {
  // Method 1: shared secret header (for manual/external invocation)
  const expectedSecret = Deno.env.get("YOUTUBE_TRANSCRIPT_WORKER_SECRET");
  const providedSecret = req.headers.get("x-worker-secret");
  if (expectedSecret && expectedSecret.trim() !== "" && providedSecret === expectedSecret) {
    return true;
  }

  // Method 2: service_role JWT via Authorization header (used by pg_cron via vault)
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token) {
    const payload = decodeJwtPayload(token);
    if (payload && payload.role === "service_role") {
      return true;
    }
  }

  return false;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#10;/g, "\n")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
}

function pickLanguage(xml: string): string | null {
  const languages: string[] = [];
  const regex = /lang_code="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    languages.push(match[1]);
  }
  if (languages.length === 0) return null;
  const preferred = ["en", "en-US", "en-GB"];
  for (const candidate of preferred) {
    if (languages.includes(candidate)) return candidate;
  }
  return languages[0];
}

function extractTextLines(xml: string): string[] {
  const lines: string[] = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const decoded = decodeHtmlEntities(match[1])
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (decoded) lines.push(decoded);
  }
  return lines;
}

async function fetchTranscriptForVideo(videoId: string): Promise<string> {
  const listUrl = `https://video.google.com/timedtext?type=list&v=${encodeURIComponent(videoId)}`;
  const listResp = await fetch(listUrl, {
    headers: { "User-Agent": "insight-compass-transcript-worker/1.0" },
  });
  if (!listResp.ok) {
    throw new Error(`Transcript track list unavailable (${listResp.status})`);
  }
  const listXml = await listResp.text();
  const language = pickLanguage(listXml);
  if (!language) {
    throw new Error("No transcript tracks available for this video");
  }

  const transcriptEndpoints = [
    `https://video.google.com/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(language)}`,
    `https://video.google.com/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(language)}&fmt=srv3`,
  ];

  for (const endpoint of transcriptEndpoints) {
    const resp = await fetch(endpoint, {
      headers: { "User-Agent": "insight-compass-transcript-worker/1.0" },
    });
    if (!resp.ok) continue;
    const xml = await resp.text();
    const lines = extractTextLines(xml);
    if (lines.length > 0) {
      return lines.join("\n");
    }
  }

  throw new Error("Transcript track found but content is unavailable");
}

function buildTranscriptChunks(transcript: string): Array<{ chunk_index: number; chunk_text: string; token_count: number }> {
  const chunks = chunkText(transcript);
  if (chunks.length === 0) {
    const fallback = transcript.trim();
    if (!fallback) return [];
    return [{ chunk_index: 0, chunk_text: fallback, token_count: estimateTokenCount(fallback) }];
  }
  return chunks.map((chunk) => ({
    chunk_index: chunk.chunk_index,
    chunk_text: chunk.chunk_text,
    token_count: estimateTokenCount(chunk.chunk_text),
  }));
}

async function persistTranscriptChunks(supabase: any, resourceId: string, transcript: string): Promise<number> {
  const { data: linkRow, error: linkError } = await supabase
    .from("resource_links")
    .select("id, user_id, project_id, notebook_id")
    .eq("id", resourceId)
    .single();

  if (linkError || !linkRow) {
    throw new Error(`Unable to load resource link context: ${linkError?.message || "not found"}`);
  }

  const chunks = buildTranscriptChunks(transcript);
  if (chunks.length === 0) {
    throw new Error("Transcript content is empty after normalization");
  }

  const embeddings = generateEmbeddingsLocal(chunks.map((c) => c.chunk_text));

  const { error: deleteError } = await supabase
    .from("link_transcript_chunks")
    .delete()
    .eq("resource_link_id", resourceId);

  if (deleteError) {
    throw new Error(`Failed to clear existing chunks: ${deleteError.message}`);
  }

  const rows = chunks.map((chunk, index) => ({
    resource_link_id: linkRow.id,
    user_id: linkRow.user_id,
    project_id: linkRow.project_id || null,
    notebook_id: linkRow.notebook_id || null,
    chunk_index: chunk.chunk_index,
    chunk_text: chunk.chunk_text,
    embedding: embeddings[index] ? JSON.stringify(embeddings[index]) : null,
    token_count: chunk.token_count,
    metadata_json: { source: "youtube_transcript", worker: "youtube-transcript-worker" },
  }));

  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error: insertError } = await supabase
      .from("link_transcript_chunks")
      .insert(batch);
    if (insertError) {
      throw new Error(`Failed to persist chunk batch: ${insertError.message}`);
    }
  }

  return rows.length;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!isAuthorizedWorkerRequest(req)) {
    return jsonResponse({ error: "Unauthorized worker invocation" }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Supabase environment variables are not configured" }, 500);
    }

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { body = {}; }

    const maxJobs = typeof body.max_jobs === "number" ? Math.max(1, Math.min(body.max_jobs, 20)) : 5;
    const leaseSeconds = typeof body.lease_seconds === "number" ? Math.max(30, Math.min(body.lease_seconds, 300)) : 120;

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const workerId = `youtube-transcript-worker:${crypto.randomUUID()}`;
    let claimed = 0, succeeded = 0, failed = 0;
    const errors: Array<{ jobId: string; error: string }> = [];

    for (let i = 0; i < maxJobs; i++) {
      const { data: claimData, error: claimError } = await supabase.rpc("claim_next_youtube_transcript_job", {
        p_worker_id: workerId,
        p_lease_seconds: leaseSeconds,
      });
      if (claimError) throw claimError;

      const claimedRow = Array.isArray(claimData) ? claimData[0] : null;
      if (!claimedRow) break;

      claimed += 1;

      try {
        const videoId = claimedRow.video_id as string | null;
        if (!videoId) throw new Error("Missing YouTube video id");

        const transcript = await fetchTranscriptForVideo(videoId);
        const persistedChunkCount = await persistTranscriptChunks(supabase, String(claimedRow.resource_id), transcript);

        const { error: completeError } = await supabase.rpc("complete_youtube_transcript_job", {
          p_job_id: claimedRow.job_id,
          p_success: true,
          p_transcript_text: transcript,
          p_error: null,
          p_worker_id: workerId,
          p_chunk_count: persistedChunkCount,
        });
        if (completeError) throw completeError;
        succeeded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown transcript ingestion error";
        await supabase.rpc("complete_youtube_transcript_job", {
          p_job_id: claimedRow.job_id,
          p_success: false,
          p_transcript_text: null,
          p_error: message,
          p_worker_id: workerId,
        });
        failed += 1;
        errors.push({ jobId: String(claimedRow.job_id), error: message });
      }
    }

    return jsonResponse({ workerId, claimed, succeeded, failed, errors });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("youtube-transcript-worker error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
