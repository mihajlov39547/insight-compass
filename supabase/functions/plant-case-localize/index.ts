// @ts-nocheck
// Language-aware formatter for Plant Case Extract/Crawl results.
// Takes raw extracted/crawled markdown and rewrites it in the Plant Advisor
// identification language (English or Serbian Latin), stripping boilerplate
// and enforcing chemical-safety restrictions.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getModelForTask } from "../_shared/ai/task-model-config.ts";
import { requireUser } from "../_shared/auth/require-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = getModelForTask("extract_synthesis");
const MAX_INPUT_CHARS = 28000;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const auth = await requireUser(req, corsHeaders);
  if ("response" in auth) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    const lang = body?.lang === "sr" ? "sr" : "en";
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    const mode = body?.mode === "crawl" ? "crawl" : "extract";

    if (!content) {
      return new Response(JSON.stringify({ error: "Invalid input: content is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) {
      // Fail soft: caller falls back to the raw content.
      return new Response(
        JSON.stringify({ content: null, model: null, error: "LOVABLE_API_KEY not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const targetLanguage =
      lang === "sr"
        ? "Serbian written in Latin script (srpski, latinica)"
        : "English";

    const systemPrompt = [
      `You reformat web ${mode} results for a plant care assistant.`,
      `Write the ENTIRE output in ${targetLanguage}. Translate source text if it is in another language.`,
      "Use ONLY the provided extracted content. Never invent facts, numbers, or sources.",
      "Remove raw HTML, navigation menus, cookie/consent notices, ads, boilerplate and irrelevant fragments.",
      "Preserve scientific/botanical names (Latin binomials) exactly as written, unchanged.",
      "SAFETY: never include chemical pesticide/fungicide/herbicide product names, active ingredients, dosages, mixing ratios or application rates. If the source contains such details, omit them and, where useful, note that a local expert should be consulted.",
      "Do NOT add a 'References' or 'Sources' section and do not list URLs — sources are rendered separately in the UI.",
      "Output clean Markdown with short headings and bullet points. No preamble about what you are doing.",
    ].join(" ");

    const userPrompt =
      (question ? `User question: ${question}\n\n` : "") +
      `Extracted content:\n\n${content.slice(0, MAX_INPUT_CHARS)}`;

    const ai = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!ai.ok) {
      const error =
        ai.status === 429
          ? "Rate limit exceeded"
          : ai.status === 402
            ? "AI credits exhausted"
            : `AI formatting failed (${ai.status})`;
      console.warn("plant-case-localize non-ok", { status: ai.status });
      return new Response(JSON.stringify({ content: null, model: null, error }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await ai.json().catch(() => ({}));
    const out = data?.choices?.[0]?.message?.content;
    const formatted = typeof out === "string" && out.trim() ? out.trim() : null;

    return new Response(
      JSON.stringify({
        content: formatted,
        model: formatted ? MODEL : null,
        lang,
        error: formatted ? null : "AI formatting returned empty content",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("plant-case-localize error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
