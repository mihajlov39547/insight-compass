// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  CHAT_MODEL_ALLOWLIST,
  DEFAULT_CHAT_MODEL,
  resolveModelDecision,
  resolveModelForTask,
} from "../_shared/ai/task-model-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_MODEL = DEFAULT_CHAT_MODEL;

const VALID_MODELS = new Set(CHAT_MODEL_ALLOWLIST);

interface DocumentContext {
  id: string;
  fileName: string;
  summary?: string;
  excerpt?: string;
  sourceType?: "document" | "youtube_transcript";
  url?: string;
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

function estimatePromptComplexity(prompt: string): "low" | "medium" | "high" {
  const lower = prompt.toLowerCase();
  const highSignals = [
    "compare",
    "tradeoff",
    "analy",
    "reason",
    "derive",
    "prove",
    "root cause",
    "architecture",
    "multi-step",
    "synthesize",
  ];
  const mediumSignals = ["explain", "summarize", "outline", "plan", "evaluate"];

  const highHits = highSignals.filter((token) => lower.includes(token)).length;
  const mediumHits = mediumSignals.filter((token) => lower.includes(token)).length;

  if (highHits >= 2 || prompt.length >= 1400) return "high";
  if (highHits >= 1 || mediumHits >= 1 || prompt.length >= 420) return "medium";
  return "low";
}

function requiresStructuredOutput(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return (
    lower.includes("json") ||
    lower.includes("schema") ||
    lower.includes("table") ||
    lower.includes("csv") ||
    lower.includes("yaml") ||
    lower.includes("xml")
  );
}

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

    const docs = Array.isArray(documentContext) ? (documentContext as DocumentContext[]) : [];
    const web = Array.isArray(webContext) ? (webContext as WebContextItem[]) : [];
    const chatMessages = Array.isArray(messages) ? messages : [];

    const latestUserPrompt = [...chatMessages]
      .reverse()
      .find((m: any) => m && m.role === "user" && typeof m.content === "string")?.content ?? "";

    const promptLength = latestUserPrompt.length;
    const docContextLength = docs.reduce((sum, d) => sum + (d.summary?.length || 0) + (d.excerpt?.length || 0), 0);
    const webContextLength = web.reduce((sum, w) => sum + (w.content?.length || 0), 0);
    const contextLength = docContextLength + webContextLength;
    const sourceCount = docs.length + web.length;

    const autoTask = (notebookScope || docs.length > 0 || (!notebookScope && web.length > 0))
      ? "chat_grounded"
      : "chat_default";

    const requestedModel = typeof model === "string" ? model.trim() : "";
    const autoDecision = resolveModelDecision(autoTask, {
      promptLength,
      contextLength,
      sourceCount,
      complexity: estimatePromptComplexity(latestUserPrompt),
      isUserFacing: true,
      requiresStructuredOutput: requiresStructuredOutput(latestUserPrompt),
      latencySensitive: normalizeResponseLength(responseLength) === "concise",
      costSensitive: normalizeResponseLength(responseLength) === "standard",
    });
    const resolvedModel = !requestedModel || requestedModel === "auto"
      ? resolveModelForTask(autoTask, autoDecision.normalizedContext)
      : (VALID_MODELS.has(requestedModel) ? requestedModel : DEFAULT_MODEL);
    const responseLengthConfig = getResponseLengthConfig(responseLength);
    console.log("[chat:length] resolved", {
      incoming: responseLength ?? null,
      requestedModel: requestedModel || null,
      autoTask,
      autoResolution: requestedModel && requestedModel !== "auto"
        ? null
        : {
            model: autoDecision.model,
            reason: autoDecision.reason,
            rules: autoDecision.appliedRules,
            context: autoDecision.normalizedContext,
          },
      strategy: responseLengthConfig.strategy,
      maxOutputTokens: responseLengthConfig.maxOutputTokens,
      model: resolvedModel,
    });

    // Build document grounding section
    let documentGrounding = "";
    if (docs.length > 0) {
      const docSections = docs.map((doc, i) => {
        const isVideo = doc.sourceType === "youtube_transcript";
        const label = isVideo ? "YouTube Video Transcript" : "Document";
        let section = `[${label} ${i + 1}: ${doc.fileName}]`;
        if (isVideo && doc.url) section += `\nVideo URL: ${doc.url}`;
        if (doc.summary) section += `\nSummary: ${doc.summary}`;
        if (doc.excerpt) section += `\n${isVideo ? "Transcript excerpt" : "Relevant excerpt"}: ${doc.excerpt}`;
        return section;
      }).join("\n\n");

      if (notebookScope) {
        const videoCount = docs.filter((d) => d.sourceType === "youtube_transcript").length;
        const docCount = docs.length - videoCount;
        const sourceMix = videoCount > 0 && docCount > 0
          ? `${docCount} document(s) and ${videoCount} YouTube video transcript(s)`
          : videoCount > 0
            ? `${videoCount} YouTube video transcript(s)`
            : `${docCount} document(s)`;

        documentGrounding = `

You are working within a notebook that has exactly ${docs.length} enabled source(s) — ${sourceMix}. These are the ONLY sources you have access to. You do NOT have access to any other documents, sources, or materials beyond what is listed below. YouTube video transcripts ARE sources — treat them with the same authority as documents.

--- BEGIN ENABLED NOTEBOOK SOURCES (${docs.length} total) ---
${docSections}
--- END ENABLED NOTEBOOK SOURCES ---

STRICT RULES for notebook-scoped answers:
- You can ONLY reference the ${docs.length} source(s) listed above (documents AND video transcripts both count)
- Do NOT mention, summarize, or reference any sources not listed above
- Do NOT invent or hallucinate additional sources
- If asked "what sources do you have access to", list ALL ${docs.length} source(s) above by name, indicating which are documents and which are YouTube videos
- If the provided sources don't cover a topic, say so honestly — do NOT pretend you have other sources
- When you use information from a source, mention which source it came from (use the video title for YouTube transcripts)`;
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

Source citation rules (STRICT):
- Do NOT include a "References", "References — ...", "Sources", or "Sources used" section in the answer body
- Do NOT add a numbered or bulleted list of URLs at the end of the answer
- Do NOT print raw URLs as a bibliography
- Sources are rendered separately in a dedicated UI box below the answer — never duplicate them in the text
- You MAY mention a source name inline (e.g. "according to Document X") when it aids clarity, but never as a trailing list

Final answer-shaping instruction (baseline, not an absolute lock):
- ${responseLengthConfig.instruction}`;

    const hasLengthInstruction = systemPrompt.includes(responseLengthConfig.instruction);
    console.log("[chat:length] prompt", {
      strategy: responseLengthConfig.strategy,
      hasLengthInstruction,
    });

    // OpenAI gpt-5 / gpt-5.2 reject the legacy `max_tokens` param and
    // use reasoning tokens that count against max_completion_tokens.
    // Bump the limit for OpenAI reasoning models so internal chain-of-thought
    // doesn't consume the entire budget, leaving nothing for the answer.
    const isOpenAI = resolvedModel.startsWith("openai/");
    const isOpenAIReasoning = isOpenAI && !resolvedModel.includes("nano") && !resolvedModel.includes("mini");
    const effectiveMaxTokens = isOpenAIReasoning
      ? Math.max(responseLengthConfig.maxOutputTokens * 4, 1024)
      : responseLengthConfig.maxOutputTokens;
    const tokenLimitField = isOpenAI
      ? { max_completion_tokens: effectiveMaxTokens }
      : { max_tokens: responseLengthConfig.maxOutputTokens };

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
          ...tokenLimitField,
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
