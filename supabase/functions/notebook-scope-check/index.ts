// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { notebookTitle, notebookDescription, sourceSummaries, userQuestion } = await req.json();

    if (!userQuestion || typeof userQuestion !== "string") {
      return new Response(
        JSON.stringify({ error: "userQuestion is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Build context about the notebook
    let notebookContext = "";
    if (notebookTitle) notebookContext += `Notebook title: "${notebookTitle}"\n`;
    if (notebookDescription) notebookContext += `Notebook description: "${notebookDescription}"\n`;
    if (sourceSummaries && sourceSummaries.length > 0) {
      notebookContext += `Notebook sources: ${sourceSummaries.map((s: string) => `"${s}"`).join(", ")}\n`;
    }

    const systemPrompt = `You are a strict scope classifier for a notebook-based Q&A system.

Given a notebook's topic context and a user question, classify whether the question is within the notebook's scope.

${notebookContext}
Classify the user's question into exactly one category:
- "aligned" — the question is directly about the notebook's topic or clearly answerable from its sources
- "partially_aligned" — the question is tangentially related or connects to the notebook topic but also covers other domains
- "not_aligned" — the question is clearly about a different topic, unrelated to the notebook scope

Respond with ONLY a JSON object (no markdown, no backticks):
{"alignment":"aligned|partially_aligned|not_aligned","reason":"short reason"}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userQuestion },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.error("Scope check gateway error:", response.status);
      // On error, default to aligned so chat isn't blocked
      return new Response(
        JSON.stringify({ alignment: "aligned", reason: "scope check unavailable, defaulting to aligned" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content ?? "";

    // Parse the JSON from the model response
    try {
      // Strip potential markdown code fences
      const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);
      const alignment = ["aligned", "partially_aligned", "not_aligned"].includes(parsed.alignment)
        ? parsed.alignment
        : "aligned";
      return new Response(
        JSON.stringify({ alignment, reason: parsed.reason || "" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch {
      // If parsing fails, default to aligned
      console.error("Failed to parse scope check response:", raw);
      return new Response(
        JSON.stringify({ alignment: "aligned", reason: "parse error, defaulting to aligned" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (e) {
    console.error("notebook-scope-check error:", e);
    return new Response(
      JSON.stringify({ alignment: "aligned", reason: "error, defaulting to aligned" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
