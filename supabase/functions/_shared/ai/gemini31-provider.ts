// @ts-nocheck
//
// Gemini 3.1 logical-model provider — served via Google AI Studio (GEMINI_API_KEY_FREE).
//
// The frontend exposes a single dropdown option "gemini-3.1". This provider
// routes each request to one of three underlying Gemini models with a
// deterministic hash-based sampler + complexity heuristic.
//
// Distribution target:
//   ~70%  gemini-3.1-flash-lite   (HIGH thinking)  — default
//   ~15%  gemini-2.5-flash  (MEDIUM/HIGH)    — complex / search-heavy
//   ~15%  gemini-3.1-pro-preview  (LOW/MEDIUM/HIGH) — very complex

import { GoogleGenAI } from "https://esm.sh/@google/genai@0.14.1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Gemini31ModelId =
  | "gemini-3.1-flash-lite"
  | "gemini-2.5-flash"
  | "gemini-3.1-pro-preview";

type ThinkingLevel = "LOW" | "MEDIUM" | "HIGH";

interface Gemini31Route {
  model: Gemini31ModelId;
  thinkingLevel: ThinkingLevel;
  reason: string;
}

interface OpenAIMessage {
  role: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Plan guard
// ---------------------------------------------------------------------------

export function assertCanUseGemini31(userPlan: string) {
  if (userPlan !== "basic" && userPlan !== "premium" && userPlan !== "enterprise") {
    const error = new Error("Gemini 3.1 is available on Basic and Premium plans.");
    (error as any).statusCode = 403;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

function hashToPercent(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash % 100;
}

const COMPLEX_TERMS = [
  "analyze", "compare", "evaluate", "debug", "implement",
  "architecture", "architect", "refactor", "production",
  "edge case", "security", "threat model", "multi-step",
  "synthesize", "reason", "plan", "long context",
  "current docs", "latest", "web search",
];

const VERY_COMPLEX_TERMS = [
  "deep analysis", "complex reasoning", "debug this codebase",
  "multi-file", "system design", "architecture review",
  "production-grade", "threat model", "synthesize all",
  "large notebook",
];

function isComplexPrompt(prompt: string): boolean {
  const text = prompt.toLowerCase();
  return COMPLEX_TERMS.some((t) => text.includes(t));
}

function isVeryComplexPrompt(prompt: string, contextDocumentCount?: number): boolean {
  const text = prompt.toLowerCase();
  if ((contextDocumentCount ?? 0) >= 5) return true;
  if (text.length > 6000) return true;
  return VERY_COMPLEX_TERMS.some((t) => text.includes(t));
}

export function selectGemini31Route(input: {
  prompt: string;
  userId: string;
  conversationId: string;
  messageId: string;
  contextDocumentCount?: number;
  hasCode?: boolean;
  webSearchEnabled?: boolean;
}): Gemini31Route {
  const sampler = hashToPercent(
    `${input.userId}:${input.conversationId}:${input.messageId}`,
  );

  const complex =
    isComplexPrompt(input.prompt) ||
    input.hasCode === true ||
    input.webSearchEnabled === true ||
    (input.contextDocumentCount ?? 0) >= 3;

  const veryComplex = isVeryComplexPrompt(input.prompt, input.contextDocumentCount);

  // Very-complex sampled escalation to Pro (~5%)
  if (veryComplex && sampler < 5) {
    return {
      model: "gemini-3.1-pro-preview",
      thinkingLevel: "HIGH",
      reason: "very_complex_sampled_pro",
    };
  }

  // Complex sampled escalation to Flash Preview (~10%)
  if (complex && sampler >= 5 && sampler < 15) {
    return {
      model: "gemini-2.5-flash",
      thinkingLevel: input.webSearchEnabled || input.hasCode ? "HIGH" : "MEDIUM",
      reason: "complex_sampled_flash_preview",
    };
  }

  // Default: Flash Lite + HIGH (~70%+)
  return {
    model: "gemini-3.1-flash-lite",
    thinkingLevel: "HIGH",
    reason: "default_flash_lite_high",
  };
}

// ---------------------------------------------------------------------------
// Message conversion
// ---------------------------------------------------------------------------

function toGoogleContents(messages: OpenAIMessage[]) {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
}

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------

export interface StreamGemini31Input {
  userId: string;
  conversationId: string;
  messageId: string;
  systemPrompt: string;
  promptForHeuristic: string;
  messages: OpenAIMessage[];
  contextDocumentCount?: number;
  hasCode?: boolean;
  webSearchEnabled?: boolean;
  /** When provided, overrides the routing heuristic thinking level. */
  requestedThinkingLevel?: "LOW" | "MEDIUM" | "HIGH";
}


export async function streamGemini31Response(
  input: StreamGemini31Input,
  writer: WritableStreamDefaultWriter<Uint8Array>,
) {
  const GEMINI_API_KEY_FREE = Deno.env.get("GEMINI_API_KEY_FREE");
  if (!GEMINI_API_KEY_FREE) {
    throw new Error("GEMINI_API_KEY_FREE is not configured");
  }

  const geminiAi = new GoogleGenAI({ apiKey: GEMINI_API_KEY_FREE });
  const route = selectGemini31Route({
    prompt: input.promptForHeuristic,
    userId: input.userId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    contextDocumentCount: input.contextDocumentCount,
    hasCode: input.hasCode,
    webSearchEnabled: input.webSearchEnabled,
  });
  if (input.requestedThinkingLevel) {
    route.thinkingLevel = input.requestedThinkingLevel;
    route.reason = `${route.reason}+user_${input.requestedThinkingLevel}`;
  }


  console.log("[gemini31] route", {
    model: route.model,
    thinkingLevel: route.thinkingLevel,
    reason: route.reason,
    contextDocs: input.contextDocumentCount ?? 0,
    webSearch: !!input.webSearchEnabled,
  });

  const contents = toGoogleContents(input.messages);
  const GOOGLE_SEARCH_TOOL = { googleSearch: {} };

  const baseConfig: any = {
    systemInstruction: input.systemPrompt
      ? [{ text: input.systemPrompt }]
      : undefined,
    tools: [GOOGLE_SEARCH_TOOL],
  };

  const encoder = new TextEncoder();
  const seenUris = new Set<string>();
  const sources: Array<{ title?: string; uri: string }> = [];

  async function writeSSE(text: string) {
    const chunk = { choices: [{ delta: { content: text }, index: 0 }] };
    await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  }

  function collectGrounding(chunk: any) {
    const candidates = chunk?.candidates ?? [];
    for (const c of candidates) {
      const gm = c?.groundingMetadata;
      const gcs = gm?.groundingChunks ?? [];
      for (const gc of gcs) {
        const web = gc?.web;
        if (web?.uri && !seenUris.has(web.uri)) {
          seenUris.add(web.uri);
          sources.push({ title: web.title, uri: web.uri });
        }
      }
    }
  }

  async function attempt(modelId: string, cfg: any): Promise<boolean> {
    try {
      const resp = await geminiAi.models.generateContentStream({
        model: modelId,
        config: cfg,
        contents,
      });
      for await (const chunk of resp) {
        collectGrounding(chunk);
        if (chunk.text) await writeSSE(chunk.text);
      }
      return true;
    } catch (err: any) {
      console.error(`[gemini31] error model=${modelId}:`, err?.message ?? err);
      return false;
    }
  }

  // Attempt 1: chosen route + thinkingConfig + googleSearch
  const cfg1 = { ...baseConfig, thinkingConfig: { thinkingLevel: route.thinkingLevel } };
  let ok = await attempt(route.model, cfg1);

  // Attempt 2: same model without thinkingConfig
  if (!ok) {
    console.log("[gemini31] retry without thinkingConfig");
    ok = await attempt(route.model, baseConfig);
  }

  // Attempt 3: fallback to Flash Lite HIGH (only if not already that)
  if (!ok && route.model !== "gemini-3.1-flash-lite") {
    console.log("[gemini31] fallback to gemini-3.1-flash-lite HIGH");
    const finalCfg = { ...baseConfig, thinkingConfig: { thinkingLevel: "HIGH" } };
    ok = await attempt("gemini-3.1-flash-lite", finalCfg);
  }

  if (!ok) {
    await writeSSE("Gemini 3.1 is temporarily unavailable. Please try again or switch to another model.");
  }

  // Emit sources as a final SSE event (kept distinct from chat tokens)
  if (sources.length > 0) {
    await writer.write(
      encoder.encode(`event: sources\ndata: ${JSON.stringify({ sources })}\n\n`),
    );
  }

  await writer.write(encoder.encode("data: [DONE]\n\n"));
  await writer.close();
}
