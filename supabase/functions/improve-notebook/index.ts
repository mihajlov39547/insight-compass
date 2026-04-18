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
    const { notebookName, currentDescription, documents, userMessage, assistantMessage, mode } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const contextParts: string[] = [];
    if (notebookName) contextParts.push(`Notebook name: "${notebookName}"`);
    if (currentDescription) contextParts.push(`Current description: "${currentDescription}"`);

    if (documents && documents.length > 0) {
      const docList = documents.slice(0, 15).map((d: any, i: number) => {
        let entry = `${i + 1}. ${d.fileName}`;
        if (d.summary) entry += ` — ${d.summary}`;
        return entry;
      }).join("\n");
      contextParts.push(`Notebook documents:\n${docList}`);
    }

    if (userMessage) contextParts.push(`First user question: "${userMessage.slice(0, 500)}"`);
    if (assistantMessage) contextParts.push(`First assistant answer: "${assistantMessage.slice(0, 500)}"`);

    const context = contextParts.join("\n\n");

    // mode: "auto" (title+description after first exchange), "description" (improve description only)
    if (mode === "description") {
      const systemPrompt = `You are a concise notebook description writer. Given notebook context, write an improved notebook description.

Rules:
- Output ONLY the description text, nothing else
- 1 to 3 sentences maximum
- Plain text, no markdown, no bullet points, no quotation marks
- Professional and clear
- Reflect the actual notebook content based on documents and chat context
- If the current description has useful intent, preserve it
- Do not be generic; be specific to the notebook content`;

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Improve this notebook description based on the following context:\n\n${context}` },
          ],
        }),
      });

      if (!response.ok) {
        if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limit reached." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (response.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        throw new Error("AI service temporarily unavailable");
      }

      const data = await response.json();
      const description = data.choices?.[0]?.message?.content?.trim() || "";
      return new Response(JSON.stringify({ description }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // mode === "auto": generate both title and description
    const systemPrompt = `You are a notebook naming assistant. Given context about a research notebook, generate an improved title and description.

Rules:
- Return a JSON object with "title" and "description" fields ONLY
- Title: 3 to 7 words, clear and descriptive, no generic words like "Notebook" or "Research" unless truly fitting
- Description: 1 to 3 sentences, plain text, no markdown
- Refine the user's original title intent, do not replace it with something unrelated
- Be specific to the actual notebook content
- No quotation marks around values`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-5-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Improve this notebook's title and description based on context:\n\n${context}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "improve_notebook",
            description: "Return improved notebook title and description",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string", description: "Improved notebook title, 3-7 words" },
                description: { type: "string", description: "Improved notebook description, 1-3 sentences" },
              },
              required: ["title", "description"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "improve_notebook" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limit reached." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error("AI service temporarily unavailable");
    }

    const data = await response.json();
    let result = { title: "", description: "" };

    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        result = JSON.parse(toolCall.function.arguments);
      } catch {
        // Fallback: try parsing from content
        const content = data.choices?.[0]?.message?.content || "";
        try { result = JSON.parse(content); } catch {}
      }
    }

    // Clean up
    result.title = (result.title || "").replace(/^["']|["']$/g, "").replace(/[.!?]+$/, "").trim();
    result.description = (result.description || "").replace(/^["']|["']$/g, "").trim();

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("improve-notebook error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
