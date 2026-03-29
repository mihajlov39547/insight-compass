// @ts-nocheck
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

interface WebContextItem {
  id?: string;
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  favicon?: string | null;
}

type ResponseLengthStrategy = "concise" | "standard" | "detailed";

function normalizeResponseLength(value: unknown): ResponseLengthStrategy {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "standard";
  if (normalized === "concise") return "concise";
  if (normalized === "detailed") return "detailed";
  return "standard";
}

function getResponseLengthConfig(value: unknown): { strategy: ResponseLengthStrategy; instruction: string; maxOutputTokens: number } {
  const strategy = normalizeResponseLength(value);
  if (strategy === "concise") {
    return {
      strategy,
      instruction:
        "Use one short paragraph with a direct answer first. Target roughly 2–4 sentences. Do not add extra background unless essential for correctness. If the user explicitly asks for more detail, follow the user request.",
      maxOutputTokens: 180,
    };
  }
  if (strategy === "detailed") {
    return {
      strategy,
      instruction:
        "Use multiple short paragraphs (4+ when appropriate). Include reasoning, nuance, caveats, and implementation detail when relevant. Expand key points with practical specifics. If the user explicitly asks for a shorter answer, follow the user request.",
      maxOutputTokens: 1200,
    };
  }
  return {
    strategy,
    instruction:
      "Use 2–3 short paragraphs. Provide a direct answer plus brief context/explanation with moderate detail. If the user explicitly asks for shorter or longer output, follow the user request.",
    maxOutputTokens: 520,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, projectDescription, model, documentContext, notebookScope, webContext, responseLength } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const resolvedModel = (model && VALID_MODELS.has(model)) ? model : DEFAULT_MODEL;
    const responseLengthConfig = getResponseLengthConfig(responseLength);
    console.log("[chat:length] resolved", {
      incoming: responseLength ?? null,
      strategy: responseLengthConfig.strategy,
      maxOutputTokens: responseLengthConfig.maxOutputTokens,
      model: resolvedModel,
    });

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

      if (notebookScope) {
        documentGrounding = `

You are working within a notebook that has exactly ${docs.length} enabled source(s). These are the ONLY sources you have access to. You do NOT have access to any other documents, sources, or materials beyond what is listed below.

--- BEGIN ENABLED NOTEBOOK SOURCES (${docs.length} total) ---
${docSections}
--- END ENABLED NOTEBOOK SOURCES ---

STRICT RULES for notebook-scoped answers:
- You can ONLY reference the ${docs.length} source(s) listed above
- Do NOT mention, summarize, or reference any documents not listed above
- Do NOT invent or hallucinate additional sources
- If asked "what sources do you have access to" or "what documents are available", list ONLY the ${docs.length} source(s) above by name
- If the provided sources don't cover a topic, say so honestly — do NOT pretend you have other sources
- When you use information from a source, mention which source it came from`;
      } else {
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
    } else if (notebookScope) {
      documentGrounding = `

You are working within a notebook. Currently, there are NO enabled sources available. You do not have access to any documents or sources.
If the user asks about available sources or documents, tell them no sources are currently enabled in this notebook.`;
    }

    // Build optional web grounding section (project chat only)
    let webGrounding = "";
    if (!notebookScope) {
      const web = (webContext ?? []) as WebContextItem[];
      if (web.length > 0) {
        const webSections = web.map((item, i) => {
          const title = item.title || `Web result ${i + 1}`;
          const url = item.url || "";
          const content = item.content || "";
          const score = typeof item.score === "number" ? `\nRelevance score: ${item.score}` : "";
          return `[Web ${i + 1}: ${title}]\nURL: ${url}${score}\nSnippet: ${content}`;
        }).join("\n\n");

        webGrounding = `

You also have supplemental web retrieval results for this query. Treat these as secondary support after workspace documents.

--- BEGIN WEB RESULTS (${web.length} total) ---
${webSections}
--- END WEB RESULTS ---

Web usage rules:
- Prefer workspace documents when they contain relevant information
- Use web results as supplemental or current information
- Cite only from provided web results (title/URL) when used
- Do not invent web sources, URLs, or facts outside provided snippets`;
      }
    }

    const systemPrompt = `You are a helpful workspace assistant for a document and knowledge management application. Your role is to help users explore project information, answer questions clearly, and support research and notebook-style workflows.

${projectDescription ? `The user is working in a project described as: "${projectDescription}".` : ""}${documentGrounding}${webGrounding}

Guidelines:
- Be clear, accurate, and concise
- Use markdown formatting judiciously: bold for emphasis, headings only for multi-section answers, bullet lists when listing items
- Keep responses conversational and well-structured without over-formatting
- Prefer short paragraphs over dense walls of text
- When you don't know something, say so honestly
- Help users think through problems and explore ideas
- Ground claims only in the provided sources and avoid unsupported assertions

Final answer-shaping instruction (baseline, not an absolute lock):
- ${responseLengthConfig.instruction}`;

    const hasLengthInstruction = systemPrompt.includes(responseLengthConfig.instruction);
    console.log("[chat:length] prompt", {
      strategy: responseLengthConfig.strategy,
      hasLengthInstruction,
    });

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
          max_tokens: responseLengthConfig.maxOutputTokens,
          max_completion_tokens: responseLengthConfig.maxOutputTokens,
          stream: true,
        }),
      }
    );
    console.log("[chat:length] provider-call", {
      strategy: responseLengthConfig.strategy,
      maxOutputTokens: responseLengthConfig.maxOutputTokens,
      usedField: "max_tokens,max_completion_tokens",
    });

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
