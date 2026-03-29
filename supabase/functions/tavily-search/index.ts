// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SEARCH_DEPTH = "basic" as const;
const MAX_RESULTS = 3;
const MAX_QUERY_LENGTH = 500;
const TAVILY_API_URL = "https://api.tavily.com/search";

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  favicon?: string | null;
}

interface NormalizedResult {
  title: string;
  url: string;
  content: string;
  score: number;
  favicon: string | null;
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
    const apiKey = Deno.env.get("TAVILY_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "TAVILY_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => null);
    const rawQuery = body?.query;

    if (typeof rawQuery !== "string") {
      return new Response(
        JSON.stringify({ error: "Invalid input: query must be a string" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const trimmedQuery = rawQuery.trim();
    if (!trimmedQuery) {
      return new Response(
        JSON.stringify({ error: "Invalid input: query is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (trimmedQuery.length > MAX_QUERY_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Invalid input: query must be <= ${MAX_QUERY_LENGTH} characters` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Keep payload constants centralized for easy future extension.
    const searchConfig = {
      search_depth: SEARCH_DEPTH,
      max_results: MAX_RESULTS,
    };

    const upstream = await fetch(TAVILY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: trimmedQuery,
        ...searchConfig,
      }),
    });

    if (!upstream.ok) {
      const upstreamText = await upstream.text().catch(() => "");
      console.error("tavily-search upstream failure", { status: upstream.status, bodyPreview: upstreamText.slice(0, 300) });
      return new Response(
        JSON.stringify({ error: "Tavily upstream request failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await upstream.json().catch(() => ({}));
    const rawResults: TavilyResult[] = Array.isArray(data?.results) ? data.results : [];

    const results: NormalizedResult[] = rawResults
      .slice(0, MAX_RESULTS)
      .map((r) => ({
        title: typeof r?.title === "string" ? r.title : "",
        url: typeof r?.url === "string" ? r.url : "",
        content: typeof r?.content === "string" ? r.content : "",
        score: typeof r?.score === "number" ? r.score : 0,
        favicon: typeof r?.favicon === "string" ? r.favicon : null,
      }));

    return new Response(
      JSON.stringify({
        provider: "tavily",
        query: rawQuery,
        searchDepth: SEARCH_DEPTH,
        maxResults: MAX_RESULTS,
        results,
        responseTime: typeof data?.response_time === "number" ? data.response_time : 0,
        requestId: typeof data?.request_id === "string" ? data.request_id : null,
        answer: typeof data?.answer === "string" ? data.answer : null,
        followUpQuestions: Array.isArray(data?.follow_up_questions) ? data.follow_up_questions : null,
        images: Array.isArray(data?.images) ? data.images : [],
        rawResponse: data ?? {},
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("tavily-search error", e);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
