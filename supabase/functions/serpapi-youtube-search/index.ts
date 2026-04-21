// @ts-nocheck
// SerpApi YouTube search + LLM synthesis.
// - Calls SerpApi (engine=youtube) with the user's query
// - Filters out ads, keeps only the first 5 real video results
// - Returns normalized YouTubeSearchSource[] for the UI
// - Uses gemini-3-flash-preview (non-streaming) to summarize the results
//
// The synthesized summary is what the assistant message body shows; the
// 5 YouTube source items are displayed separately by the Sources UI.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SERPAPI_URL = "https://serpapi.com/search.json";
const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const SYNTHESIS_MODEL = "google/gemini-3-flash-preview";

const MAX_RESULTS = 5;
const MAX_QUERY_LENGTH = 500;

interface YouTubeSearchSource {
  id: string;
  type: "youtube";
  title: string;
  url: string;
  videoId: string;
  channelName?: string;
  channelUrl?: string;
  publishedDate?: string;
  views?: string | number;
  length?: string;
  description?: string;
  thumbnail?: string | null;
}

function normalizeViews(raw: unknown): string | number | undefined {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return undefined;
}

function pickThumbnail(thumb: unknown): string | null {
  if (!thumb || typeof thumb !== "object") return null;
  const t = thumb as Record<string, unknown>;
  if (typeof t.static === "string") return t.static;
  if (typeof t.rich === "string") return t.rich;
  return null;
}

function extractVideoId(link: unknown, fallbackId: unknown): string | null {
  if (typeof fallbackId === "string" && fallbackId.trim()) return fallbackId.trim();
  if (typeof link !== "string") return null;
  try {
    const u = new URL(link);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return u.pathname.replace(/^\//, "") || null;
    if (host.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      // /shorts/<id>, /embed/<id>
      const m = u.pathname.match(/\/(shorts|embed)\/([A-Za-z0-9_-]{6,})/);
      if (m) return m[2];
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeYouTubeResults(raw: unknown[]): YouTubeSearchSource[] {
  const out: YouTubeSearchSource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const link = typeof r.link === "string" ? r.link : "";
    const videoId = extractVideoId(link, r.video_id);
    if (!link || !videoId) continue; // require a real YouTube video result

    const channel = (r.channel && typeof r.channel === "object")
      ? (r.channel as Record<string, unknown>)
      : {};

    const source: YouTubeSearchSource = {
      id: `youtube-${videoId}-${out.length}`,
      type: "youtube",
      title: typeof r.title === "string" ? r.title : link,
      url: link,
      videoId,
      channelName: typeof channel.name === "string" ? channel.name : undefined,
      channelUrl: typeof channel.link === "string" ? channel.link : undefined,
      publishedDate: typeof r.published_date === "string" ? r.published_date : undefined,
      views: normalizeViews(r.views),
      length: typeof r.length === "string" ? r.length : undefined,
      description: typeof r.description === "string" ? r.description : undefined,
      thumbnail: pickThumbnail(r.thumbnail),
    };

    out.push(source);
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

function buildSynthesisPrompt(query: string, sources: YouTubeSearchSource[]): string {
  const lines: string[] = [];
  lines.push(`User search query: ${query}`);
  lines.push(`\nTop ${sources.length} YouTube results found:`);
  sources.forEach((s, i) => {
    lines.push(`\n[${i + 1}] ${s.title}`);
    if (s.channelName) lines.push(`Channel: ${s.channelName}`);
    if (s.publishedDate) lines.push(`Published: ${s.publishedDate}`);
    if (s.views !== undefined) lines.push(`Views: ${s.views}`);
    if (s.length) lines.push(`Length: ${s.length}`);
    if (s.description) {
      const desc = s.description.length > 280 ? s.description.slice(0, 280) + "…" : s.description;
      lines.push(`Description: ${desc}`);
    }
  });
  return lines.join("\n");
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
    const serpapiKey = Deno.env.get("SERPAPI_KEY");
    if (!serpapiKey) {
      return new Response(
        JSON.stringify({ error: "SERPAPI_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => null);
    const rawQuery = body?.query;

    if (typeof rawQuery !== "string" || !rawQuery.trim()) {
      return new Response(
        JSON.stringify({ error: "Invalid input: `query` must be a non-empty string" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const trimmedQuery = rawQuery.trim();
    if (trimmedQuery.length > MAX_QUERY_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Invalid input: query must be <= ${MAX_QUERY_LENGTH} characters` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---- SerpApi YouTube engine ---------------------------------------
    const params = new URLSearchParams({
      engine: "youtube",
      search_query: trimmedQuery,
      api_key: serpapiKey,
    });

    const upstream = await fetch(`${SERPAPI_URL}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!upstream.ok) {
      const upstreamText = await upstream.text().catch(() => "");
      console.error("serpapi-youtube upstream failure", {
        status: upstream.status,
        bodyPreview: upstreamText.slice(0, 300),
      });
      return new Response(
        JSON.stringify({
          error: `YouTube search upstream failed (${upstream.status})`,
          upstreamStatus: upstream.status,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;

    // SerpApi returns video results under `video_results`. We deliberately
    // ignore `ads_results`, `shorts_results`, `channel_results`, and
    // `people_also_search_for` for this v1.
    const rawVideoResults = Array.isArray(data?.video_results) ? (data.video_results as unknown[]) : [];
    const sources = normalizeYouTubeResults(rawVideoResults);

    if (sources.length === 0) {
      return new Response(
        JSON.stringify({
          provider: "serpapi",
          augmentationMode: "youtube_search",
          query: trimmedQuery,
          sources: [],
          synthesizedAnswer: `No YouTube videos were found for **${trimmedQuery}**. Try rephrasing your search.`,
          synthesisError: null,
          synthesisModel: null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---- LLM synthesis (non-streaming) --------------------------------
    let synthesizedAnswer: string | null = null;
    let synthesisError: string | null = null;

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) {
      synthesisError = "LOVABLE_API_KEY not configured";
    } else {
      try {
        const systemPrompt =
          "You are a precise research assistant that summarizes YouTube search results for the user. " +
          "Use ONLY the provided video metadata (title, channel, views, length, description, published date). " +
          "Do not invent details or fabricate URLs. " +
          "Write a concise, useful overview in Markdown that helps the user decide which videos are worth watching. " +
          "Highlight the strongest matches, mention notable channels or recency when useful, " +
          "and call out duration or popularity if it's relevant. " +
          "Do NOT include a 'References' or 'Sources' or 'Links' section — the videos are listed separately in the UI. " +
          "Do NOT list raw URLs in your response.";

        const userPrompt = buildSynthesisPrompt(trimmedQuery, sources);

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
          console.warn("serpapi-youtube synthesis non-ok", { status: ai.status });
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
        console.error("serpapi-youtube synthesis error", e);
        synthesisError = e instanceof Error ? e.message : "Unknown synthesis error";
      }
    }

    // Fallback summary if synthesis failed — never return an empty assistant message.
    if (!synthesizedAnswer) {
      const lines: string[] = [`Found **${sources.length}** YouTube videos for **${trimmedQuery}**:`];
      sources.forEach((s, i) => {
        const meta: string[] = [];
        if (s.channelName) meta.push(s.channelName);
        if (s.publishedDate) meta.push(s.publishedDate);
        if (s.length) meta.push(s.length);
        const metaStr = meta.length > 0 ? ` _(${meta.join(" · ")})_` : "";
        lines.push(`${i + 1}. **${s.title}**${metaStr}`);
      });
      synthesizedAnswer = lines.join("\n");
    }

    return new Response(
      JSON.stringify({
        provider: "serpapi",
        augmentationMode: "youtube_search",
        query: trimmedQuery,
        sources,
        result_count: sources.length,
        synthesizedAnswer,
        synthesisError,
        synthesisModel: synthesisError ? null : SYNTHESIS_MODEL,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("serpapi-youtube-search error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
