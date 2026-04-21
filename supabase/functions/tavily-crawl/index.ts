// @ts-nocheck
// Tavily /crawl follow-up endpoint.
// - Accepts a single root URL selected from prior research/web-search sources
// - Optionally accepts natural-language `instructions` to guide the crawler
// - Calls Tavily /crawl (basic depth, markdown format, favicon on)
// - When instructions are provided, also runs an LLM synthesis with the
//   configured extract synthesis model using the crawled content as grounding.
//
// Returns a normalized payload that the client persists into a chat message.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getModelForTask } from "../_shared/ai/task-model-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TAVILY_CRAWL_URL = "https://api.tavily.com/crawl";
const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const SYNTHESIS_MODEL = getModelForTask("extract_synthesis");

const MAX_INSTRUCTIONS_LENGTH = 1000;
const PER_PAGE_CHAR_BUDGET = 4000;
const TOTAL_CHAR_BUDGET = 24000;

// Conservative defaults — we want a useful but bounded crawl.
const DEFAULT_MAX_DEPTH = 1;
const DEFAULT_MAX_BREADTH = 20;
const DEFAULT_LIMIT = 25;

type ExtractDepth = "basic" | "advanced";

interface CrawlRequestBody {
  url?: string;
  instructions?: string | null;
  extract_depth?: ExtractDepth;
  max_depth?: number;
  max_breadth?: number;
  limit?: number;
}

interface TavilyCrawlResultRaw {
  url?: string;
  raw_content?: string;
  favicon?: string | null;
}

interface NormalizedCrawlResult {
  url: string;
  title: string;
  raw_content: string;
  favicon: string | null;
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

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function deriveTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "");
    const last = path.split("/").filter(Boolean).pop();
    if (last) return decodeURIComponent(last).replace(/[-_]+/g, " ");
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const tavilyKey = Deno.env.get("TAVILY_API_KEY");
    if (!tavilyKey) {
      return new Response(
        JSON.stringify({ error: "TAVILY_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = (await req.json().catch(() => null)) as CrawlRequestBody | null;
    const url = typeof body?.url === "string" ? body.url.trim() : "";

    if (!isHttpUrl(url)) {
      return new Response(
        JSON.stringify({ error: "Invalid input: a valid http(s) `url` is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rawInstructions = typeof body?.instructions === "string" ? body.instructions.trim() : "";
    const instructions = rawInstructions.length > 0 ? rawInstructions.slice(0, MAX_INSTRUCTIONS_LENGTH) : null;

    const requestedDepth: ExtractDepth = body?.extract_depth === "advanced" ? "advanced" : "basic";
    const maxDepth = clampInt(body?.max_depth, 1, 5, DEFAULT_MAX_DEPTH);
    const maxBreadth = clampInt(body?.max_breadth, 1, 100, DEFAULT_MAX_BREADTH);
    const limit = clampInt(body?.limit, 1, 100, DEFAULT_LIMIT);

    // ---- Tavily /crawl --------------------------------------------------
    // Tavily's /crawl endpoint requires the Bearer auth header (api_key in
    // body is rejected with 401). We use the same Bearer pattern for all
    // Tavily endpoints for consistency.
    const crawlPayload: Record<string, unknown> = {
      url,
      extract_depth: requestedDepth,
      format: "markdown",
      include_favicon: true,
      include_images: false,
      max_depth: maxDepth,
      max_breadth: maxBreadth,
      limit,
      allow_external: false,
    };
    if (instructions) {
      crawlPayload.instructions = instructions;
      crawlPayload.chunks_per_source = 3;
    }

    const upstream = await fetch(TAVILY_CRAWL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tavilyKey}`,
      },
      body: JSON.stringify(crawlPayload),
    });

    if (!upstream.ok) {
      const upstreamText = await upstream.text().catch(() => "");
      console.error("tavily-crawl upstream failure", {
        status: upstream.status,
        bodyPreview: upstreamText.slice(0, 300),
      });
      return new Response(
        JSON.stringify({
          error: `Tavily crawl upstream request failed (${upstream.status})`,
          upstreamStatus: upstream.status,
          upstreamBody: upstreamText.slice(0, 300),
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    const baseUrl = typeof data?.base_url === "string" ? data.base_url : url;
    const rawResults = (Array.isArray(data?.results) ? data.results : []) as TavilyCrawlResultRaw[];

    const results: NormalizedCrawlResult[] = rawResults
      .map((r): NormalizedCrawlResult | null => {
        const pageUrl = typeof r?.url === "string" ? r.url : "";
        if (!pageUrl) return null;
        return {
          url: pageUrl,
          title: deriveTitleFromUrl(pageUrl),
          raw_content: typeof r?.raw_content === "string" ? r.raw_content : "",
          favicon: typeof r?.favicon === "string" ? r.favicon : null,
        };
      })
      .filter((x): x is NormalizedCrawlResult => x !== null);

    const responseTime = typeof data?.response_time === "number" ? (data.response_time as number) : null;
    const requestId = typeof data?.request_id === "string" ? (data.request_id as string) : null;

    // ---- Optional LLM synthesis ----------------------------------------
    let synthesizedAnswer: string | null = null;
    let synthesisError: string | null = null;

    if (instructions && results.length > 0) {
      const lovableKey = Deno.env.get("LOVABLE_API_KEY");
      if (!lovableKey) {
        synthesisError = "LOVABLE_API_KEY not configured";
      } else {
        try {
          let totalUsed = 0;
          const sections: string[] = [];
          for (let i = 0; i < results.length; i++) {
            if (totalUsed >= TOTAL_CHAR_BUDGET) break;
            const r = results[i];
            const remaining = TOTAL_CHAR_BUDGET - totalUsed;
            const slice = (r.raw_content || "").slice(0, Math.min(PER_PAGE_CHAR_BUDGET, remaining));
            if (!slice) continue;
            totalUsed += slice.length;
            sections.push(`[Page ${i + 1}] ${r.title}\nURL: ${r.url}\n---\n${slice}`);
          }

          const systemPrompt =
            "You are a precise research assistant. The user crawled a website and wants insights based on the natural-language instructions they provided. " +
            "Use ONLY the provided crawled page content. If the pages do not contain enough information, say so clearly. " +
            "Do NOT include a 'References' or 'Sources' section in your answer body — the crawled pages are listed separately in the UI. " +
            "Do not list URLs in the response text. Use Markdown for formatting.";

          const userPrompt =
            `Crawl instructions: ${instructions}\n\n` +
            `Root URL: ${baseUrl}\n\n` +
            `Crawled content from ${results.length} page(s):\n\n${sections.join("\n\n")}`;

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
            console.warn("tavily-crawl synthesis non-ok", { status: ai.status });
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
          console.error("tavily-crawl synthesis error", e);
          synthesisError = e instanceof Error ? e.message : "Unknown synthesis error";
        }
      }
    }

    return new Response(
      JSON.stringify({
        provider: "tavily",
        augmentationMode: "crawl",
        url,
        base_url: baseUrl,
        instructions,
        extract_depth: requestedDepth,
        max_depth: maxDepth,
        max_breadth: maxBreadth,
        limit,
        results,
        page_count: results.length,
        response_time: responseTime,
        request_id: requestId,
        synthesizedAnswer,
        synthesisError,
        synthesisModel: synthesizedAnswer ? SYNTHESIS_MODEL : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("tavily-crawl error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
