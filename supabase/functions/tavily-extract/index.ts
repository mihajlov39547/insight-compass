// @ts-nocheck
// Tavily /extract follow-up endpoint.
// - Accepts a list of URLs (selected from prior research/web-search sources)
// - Optionally accepts a follow-up question
// - Calls Tavily /extract (basic depth, markdown format, favicon on)
// - When a question is provided, also runs a quick LLM synthesis with
//   google/gemini-2.5-flash (Lovable AI Gateway) using the extracted
//   content as grounding.
//
// Returns a normalized payload that the client persists into a chat message.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getModelForTask } from "../_shared/ai/task-model-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";
const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const SYNTHESIS_MODEL = getModelForTask("extract_synthesis");

const MAX_URLS = 10;
const MAX_QUESTION_LENGTH = 1000;
const PER_SOURCE_CHAR_BUDGET = 8000; // cap per-source content fed to LLM
const TOTAL_CHAR_BUDGET = 24000;     // overall budget for synthesis context

type ExtractDepth = "basic" | "advanced";

interface ExtractRequestBody {
  urls?: string[];
  query?: string | null;
  extract_depth?: ExtractDepth;
}

interface TavilyExtractResultRaw {
  url?: string;
  title?: string;
  raw_content?: string;
  favicon?: string | null;
  images?: unknown;
}

interface TavilyExtractFailedRaw {
  url?: string;
  error?: string;
}

interface NormalizedExtractResult {
  url: string;
  title: string;
  raw_content: string;
  favicon: string | null;
}

interface NormalizedExtractFailure {
  url: string;
  error: string;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const key = u.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const tavilyKey = Deno.env.get("TAVILY_API_KEY");
    if (!tavilyKey) {
      return new Response(
        JSON.stringify({ error: "TAVILY_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = (await req.json().catch(() => null)) as ExtractRequestBody | null;
    const rawUrls = Array.isArray(body?.urls) ? body!.urls! : [];
    const validUrls = dedupeUrls(rawUrls.filter(isHttpUrl));

    if (validUrls.length === 0) {
      return new Response(
        JSON.stringify({ error: "Invalid input: at least one valid http(s) URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (validUrls.length > MAX_URLS) {
      return new Response(
        JSON.stringify({ error: `Too many URLs: max ${MAX_URLS}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawQuery = typeof body?.query === "string" ? body.query.trim() : "";
    const query = rawQuery.length > 0 ? rawQuery.slice(0, MAX_QUESTION_LENGTH) : null;

    const requestedDepth: ExtractDepth = body?.extract_depth === "advanced" ? "advanced" : "basic";

    // ---- Tavily /extract -----------------------------------------------
    // Use Bearer auth header for consistency with /crawl and Tavily's
    // documented standard. (Body api_key still works for /extract but the
    // header form is preferred and required by /crawl.)
    const extractPayload: Record<string, unknown> = {
      urls: validUrls,
      extract_depth: requestedDepth,
      format: "markdown",
      include_favicon: true,
      include_images: false,
    };
    if (query) {
      extractPayload.query = query;
      extractPayload.chunks_per_source = 3;
    }

    const upstream = await fetch(TAVILY_EXTRACT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tavilyKey}`,
      },
      body: JSON.stringify(extractPayload),
    });

    if (!upstream.ok) {
      const upstreamText = await upstream.text().catch(() => "");
      console.error("tavily-extract upstream failure", {
        status: upstream.status,
        bodyPreview: upstreamText.slice(0, 300),
      });
      return new Response(
        JSON.stringify({ error: "Tavily extract upstream request failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    const rawResults = (Array.isArray(data?.results) ? data.results : []) as TavilyExtractResultRaw[];
    const rawFailed = (Array.isArray(data?.failed_results) ? data.failed_results : []) as TavilyExtractFailedRaw[];

    // Normalize results. Tavily sometimes returns `title` empty — fall back to domain.
    const results: NormalizedExtractResult[] = rawResults
      .map((r): NormalizedExtractResult | null => {
        const url = typeof r?.url === "string" ? r.url : "";
        if (!url) return null;
        let title = typeof r?.title === "string" && r.title.trim() ? r.title.trim() : "";
        if (!title) {
          try {
            title = new URL(url).hostname.replace(/^www\./, "");
          } catch {
            title = url;
          }
        }
        return {
          url,
          title,
          raw_content: typeof r?.raw_content === "string" ? r.raw_content : "",
          favicon: typeof r?.favicon === "string" ? r.favicon : null,
        };
      })
      .filter((x): x is NormalizedExtractResult => x !== null);

    const failed_results: NormalizedExtractFailure[] = rawFailed
      .map((f) => ({
        url: typeof f?.url === "string" ? f.url : "",
        error: typeof f?.error === "string" ? f.error : "Extraction failed",
      }))
      .filter((f) => f.url);

    const responseTime = typeof data?.response_time === "number" ? (data.response_time as number) : null;
    const requestId = typeof data?.request_id === "string" ? (data.request_id as string) : null;

    // ---- Optional LLM synthesis ----------------------------------------
    let synthesizedAnswer: string | null = null;
    let synthesisError: string | null = null;

    if (query && results.length > 0) {
      const lovableKey = Deno.env.get("LOVABLE_API_KEY");
      if (!lovableKey) {
        synthesisError = "LOVABLE_API_KEY not configured";
      } else {
        try {
          // Build a budgeted context grouped by source.
          let totalUsed = 0;
          const sections: string[] = [];
          for (let i = 0; i < results.length; i++) {
            if (totalUsed >= TOTAL_CHAR_BUDGET) break;
            const r = results[i];
            const remaining = TOTAL_CHAR_BUDGET - totalUsed;
            const slice = (r.raw_content || "").slice(0, Math.min(PER_SOURCE_CHAR_BUDGET, remaining));
            if (!slice) continue;
            totalUsed += slice.length;
            sections.push(
              `[Source ${i + 1}] ${r.title}\nURL: ${r.url}\n---\n${slice}`
            );
          }

          const systemPrompt =
            "You are a precise research assistant. Answer the user's question using ONLY the provided extracted content from the listed sources. " +
            "If the sources do not contain enough information, say so clearly. " +
            "Do NOT include a 'References' or 'Sources' section in your answer body — sources are rendered separately in the UI. " +
            "Do not list URLs in the response text. Use Markdown for formatting.";

          const userPrompt =
            `Question: ${query}\n\n` +
            `Extracted content from ${results.length} source(s):\n\n${sections.join("\n\n")}`;

          const ai = await fetch(LOVABLE_AI_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${lovableKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: SYNTHESIS_MODEL,
              stream: false,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
            }),
          });

          if (!ai.ok) {
            if (ai.status === 429) synthesisError = "Rate limit exceeded for AI synthesis";
            else if (ai.status === 402) synthesisError = "AI credits exhausted";
            else synthesisError = `AI synthesis failed (${ai.status})`;
            console.warn("tavily-extract synthesis non-ok", { status: ai.status });
          } else {
            const aiData = await ai.json().catch(() => ({}));
            const content = aiData?.choices?.[0]?.message?.content;
            if (typeof content === "string" && content.trim()) {
              synthesizedAnswer = content.trim();
            } else {
              synthesisError = "AI synthesis returned empty content";
            }
          }
        } catch (e) {
          console.error("tavily-extract synthesis error", e);
          synthesisError = e instanceof Error ? e.message : "Unknown synthesis error";
        }
      }
    }

    return new Response(
      JSON.stringify({
        provider: "tavily",
        augmentationMode: "extract",
        query,
        urls: validUrls,
        extract_depth: requestedDepth,
        results,
        failed_results,
        response_time: responseTime,
        request_id: requestId,
        synthesizedAnswer,
        synthesisError,
        synthesisModel: synthesizedAnswer ? SYNTHESIS_MODEL : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("tavily-extract error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
