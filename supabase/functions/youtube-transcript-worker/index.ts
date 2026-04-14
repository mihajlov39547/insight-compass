// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { fetchTranscriptForVideo } from "./transcript-fetcher.ts";
import { persistTranscriptChunks } from "./chunk-persistence.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-worker-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ------------------------------------------------------------------ */
/*  Auth helpers                                                       */
/* ------------------------------------------------------------------ */

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

function isAuthorizedWorkerRequest(req: Request): boolean {
  const expectedSecret = Deno.env.get("YOUTUBE_TRANSCRIPT_WORKER_SECRET");
  const providedSecret = req.headers.get("x-worker-secret");
  if (expectedSecret && expectedSecret.trim() !== "" && providedSecret === expectedSecret) {
    return true;
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token) {
    const payload = decodeJwtPayload(token);
    if (payload && payload.role === "service_role") return true;
  }

  return false;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* ------------------------------------------------------------------ */
/*  Main handler                                                       */
/* ------------------------------------------------------------------ */

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

        console.log(`[worker] Processing job=${claimedRow.job_id} videoId=${videoId} url=${claimedRow.normalized_url}`);

        const result = await fetchTranscriptForVideo(videoId);
        const persistedChunkCount = await persistTranscriptChunks(supabase, String(claimedRow.resource_id), result.transcript);

        // Persist debug metadata on resource_links
        const debugMeta = { transcript: { debug: result.debug, winning_strategy: result.debug.winningStrategy } };
        await supabase.from("resource_links").update({ metadata: debugMeta }).eq("id", claimedRow.resource_id);

        const { error: completeError } = await supabase.rpc("complete_youtube_transcript_job", {
          p_job_id: claimedRow.job_id,
          p_success: true,
          p_transcript_text: result.transcript,
          p_error: null,
          p_worker_id: workerId,
          p_chunk_count: persistedChunkCount,
        });
        if (completeError) throw completeError;
        succeeded += 1;
        console.log(`[worker] Job ${claimedRow.job_id} succeeded: ${persistedChunkCount} chunks`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown transcript ingestion error";
        const debugPayload = (error as any)?.debug || null;
        console.error(`[worker] Job ${claimedRow.job_id} failed: ${message}`);

        // Persist debug metadata on failure too
        if (debugPayload) {
          const debugMeta = { transcript: { debug: debugPayload, error: message } };
          await supabase.from("resource_links").update({ metadata: debugMeta }).eq("id", claimedRow.resource_id).then(() => {});
        }

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
