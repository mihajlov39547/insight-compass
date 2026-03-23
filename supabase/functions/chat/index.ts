import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_MODEL = "google/gemini-3-flash-preview";

const VALID_MODELS = new Set([
  "google/gemini-3-flash-preview",
  "google/gemini-3.1-pro-preview",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "openai/gpt-5.2",
  "openai/gpt-5",
  "openai/gpt-5-mini",
  "openai/gpt-5-nano",
]);

interface DocumentContext {
  id: string;
  fileName: string;
  summary?: string;
  excerpt?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, projectDescription, model, documentContext, notebookScope } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const resolvedModel = (model && VALID_MODELS.has(model)) ? model : DEFAULT_MODEL;

    // Build document grounding section
    let documentGrounding = "";
    const docs = (documentContext ?? []) as DocumentContext[];
    if (docs.length > 0) {
      const docSections = docs.map((doc, i) => {
        let section = `[Document ${i + 1}: ${doc.fileName}]`;
        if (doc.summary) section += `\nSummary: ${doc.summary}`;
        if (doc.excerpt) section += `\nRelevant excerpt: ${doc.excerpt}`;
        return section;
      }).join("\n\n");

      documentGrounding = `

You have access to the following documents from the user's workspace. Use them to ground your answers when relevant. If you use information from a document, mention which document it came from naturally in your response.

--- BEGIN DOCUMENTS ---
${docSections}
--- END DOCUMENTS ---

When answering:
- Prefer information from the provided documents over general knowledge
- If the documents contain relevant information, reference it
- If the documents don't cover the topic, answer from general knowledge and note that
- Do not fabricate document content`;
    }

    const systemPrompt = `You are a helpful workspace assistant for a document and knowledge management application. Your role is to help users explore project information, answer questions clearly, and support research and notebook-style workflows.

${projectDescription ? `The user is working in a project described as: "${projectDescription}".` : ""}${documentGrounding}

Guidelines:
- Be clear, accurate, and concise
- Use markdown formatting judiciously: bold for emphasis, headings only for multi-section answers, bullet lists when listing items
- Keep responses conversational and well-structured without over-formatting
- Prefer short paragraphs over dense walls of text
- When you don't know something, say so honestly
- Help users think through problems and explore ideas`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: resolvedModel,
          messages: [
            { role: "system", content: systemPrompt },
            ...messages,
          ],
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "The workspace has reached its current AI request limit. Please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI usage credits exhausted. Please add funds in Settings > Workspace > Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(
        JSON.stringify({ error: "AI service temporarily unavailable." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
