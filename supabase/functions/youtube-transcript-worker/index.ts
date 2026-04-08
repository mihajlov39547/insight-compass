// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
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
    headers: {
      "User-Agent": "insight-compass-transcript-worker/1.0",
    },
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
      headers: {
        "User-Agent": "insight-compass-transcript-worker/1.0",
      },
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
      return jsonResponse({ error: "Supabase environment variables are not configured" }, 500);
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const maxJobs = typeof body.max_jobs === "number" ? Math.max(1, Math.min(body.max_jobs, 20)) : 5;
    const leaseSeconds = typeof body.lease_seconds === "number" ? Math.max(30, Math.min(body.lease_seconds, 300)) : 120;

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
      },
    });

    const workerId = `youtube-transcript-worker:${crypto.randomUUID()}`;
    let claimed = 0;
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ jobId: string; error: string }> = [];

    for (let i = 0; i < maxJobs; i++) {
      const { data: claimData, error: claimError } = await supabase.rpc("claim_next_youtube_transcript_job", {
        p_worker_id: workerId,
        p_lease_seconds: leaseSeconds,
      });

      if (claimError) {
        throw claimError;
      }

      const claimedRow = Array.isArray(claimData) ? claimData[0] : null;
      if (!claimedRow) {
        break;
      }

      claimed += 1;

      try {
        const videoId = claimedRow.video_id as string | null;
        if (!videoId) {
          throw new Error("Missing YouTube video id");
        }

        const transcript = await fetchTranscriptForVideo(videoId);

        const { error: completeError } = await supabase.rpc("complete_youtube_transcript_job", {
          p_job_id: claimedRow.job_id,
          p_success: true,
          p_transcript_text: transcript,
          p_error: null,
        });

        if (completeError) {
          throw completeError;
        }

        succeeded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown transcript ingestion error";

        await supabase.rpc("complete_youtube_transcript_job", {
          p_job_id: claimedRow.job_id,
          p_success: false,
          p_transcript_text: null,
          p_error: message,
        });

        failed += 1;
        errors.push({ jobId: String(claimedRow.job_id), error: message });
      }
    }

    return jsonResponse({
      workerId,
      claimed,
      succeeded,
      failed,
      errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("youtube-transcript-worker error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
