// @ts-nocheck
//
// Google Gemma 4 provider — served via Google AI Studio.
//
// Google AI Studio project metadata (for reference only):
//   Project display name: github-vs-code
//   Project resource name: projects/989677864451
//   Project number: 989677864451
//   Project id: gen-lang-client-0748327175
//
// Gemma models are currently served from this project.
// Future Gemini models should also be added from the same project.

import { GoogleGenAI } from "https://esm.sh/@google/genai@0.14.1";

// ---------------------------------------------------------------------------
// Round-robin model selection
// ---------------------------------------------------------------------------

/**
 * Two Gemma 4 variants:
 *  1. gemma-4-26b-a4b-it — Mixture-of-Experts, activates 4B params per inference.
 *  2. gemma-4-31b-it     — Dense flagship model, 256K context window.
 */
const GEMMA_4_MODELS = [
  "gemma-4-26b-a4b-it",
  "gemma-4-31b-it",
] as const;

// Seed with current time so cold starts don't always pick model[0].
let gemmaRoundRobinIndex = Math.floor(Date.now() / 1000) % GEMMA_4_MODELS.length;

function pickGemma4Model(): string {
  const selected = GEMMA_4_MODELS[gemmaRoundRobinIndex % GEMMA_4_MODELS.length];
  gemmaRoundRobinIndex = (gemmaRoundRobinIndex + 1) % GEMMA_4_MODELS.length;
  return selected;
}

// ---------------------------------------------------------------------------
// Thinking-level heuristic
// ---------------------------------------------------------------------------

type ThinkingMode = "minimal" | "high";

function shouldUseHighThinking(input: {
  prompt: string;
  hasCode?: boolean;
  contextDocumentCount?: number;
  explicitReasoningMode?: boolean;
}): boolean {
  if (input.explicitReasoningMode) return true;
  if (input.hasCode) return true;
  if ((input.contextDocumentCount ?? 0) > 3) return true;

  const text = input.prompt.toLowerCase();
  return [
    "debug",
    "implement",
    "analyze",
    "compare",
    "architect",
    "plan",
    "reason",
    "calculate",
    "evaluate",
    "refactor",
    "synthesize",
    "step by step",
  ].some((keyword) => text.includes(keyword));
}

// ---------------------------------------------------------------------------
// Plan guard
// ---------------------------------------------------------------------------

export function assertCanUseGemma4(userPlan: string) {
  if (userPlan !== "premium" && userPlan !== "enterprise") {
    const error = new Error("Gemma 4 is available on Premium plan only.");
    (error as any).statusCode = 403;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Convert OpenAI-style messages to Google GenAI format
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: string;
  content: string;
}

function toGoogleContents(messages: OpenAIMessage[]) {
  // Google GenAI expects: role = "user" | "model"
  // We strip "system" messages (handled separately) and map "assistant" → "model".
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
}

// ---------------------------------------------------------------------------
// Stream Gemma 4 response
// ---------------------------------------------------------------------------

export interface StreamGemma4Input {
  messages: OpenAIMessage[];
  systemPrompt: string;
  promptForHeuristic: string;
  enableGoogleSearch?: boolean;
  explicitReasoningMode?: boolean;
  contextDocumentCount?: number;
  hasCode?: boolean;
}

/**
 * Streams a Gemma 4 response, writing SSE-formatted chunks to the provided
 * WritableStreamDefaultWriter. The format matches the OpenAI streaming
 * contract so the existing client parser works unchanged.
 */
export async function streamGemma4Response(
  input: StreamGemma4Input,
  writer: WritableStreamDefaultWriter<Uint8Array>,
) {
  const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY");
  if (!GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY is not configured");
  }

  const googleAi = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });
  const model = pickGemma4Model();

  const thinkingMode: ThinkingMode = shouldUseHighThinking({
    prompt: input.promptForHeuristic,
    hasCode: input.hasCode,
    contextDocumentCount: input.contextDocumentCount,
    explicitReasoningMode: input.explicitReasoningMode,
  })
    ? "high"
    : "minimal";

  console.log("[gemma4] selected", {
    model,
    thinkingMode,
    enableGoogleSearch: !!input.enableGoogleSearch,
    contextDocs: input.contextDocumentCount ?? 0,
  });

  const contents = toGoogleContents(input.messages);

  // Prepend system instruction as the first user turn if present
  // (Google GenAI SDK supports systemInstruction in config)
  const config: any = {};

  if (input.systemPrompt) {
    // Match Google GenAI canonical format (array of parts)
    config.systemInstruction = [{ text: input.systemPrompt }];
  }

  // Thinking config — will be retried without if the API rejects it
  let useThinking = true;
  config.thinkingConfig = {
    thinkingLevel: thinkingMode === "high" ? "HIGH" : "MINIMAL",
  };

  // Google Search grounding (prepared for future toggle integration)
  if (input.enableGoogleSearch) {
    config.tools = [{ googleSearch: {} }];
  }

  const encoder = new TextEncoder();

  async function writeSSE(text: string) {
    const chunk = {
      choices: [{ delta: { content: text }, index: 0 }],
    };
    await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  }

  async function attemptStream(modelId: string, cfg: any): Promise<boolean> {
    try {
      const response = await googleAi.models.generateContentStream({
        model: modelId,
        config: cfg,
        contents,
      });

      for await (const chunk of response) {
        if (chunk.text) {
          await writeSSE(chunk.text);
        }
      }
      return true;
    } catch (error: any) {
      console.error(`[gemma4] stream error model=${modelId}:`, error?.message ?? error);
      return false;
    }
  }

  // Primary attempt
  let success = await attemptStream(model, config);

  if (!success && useThinking) {
    // Retry without thinkingConfig (in case the model rejects it)
    console.log("[gemma4] retrying without thinkingConfig");
    const fallbackConfig = { ...config };
    delete fallbackConfig.thinkingConfig;
    success = await attemptStream(model, fallbackConfig);
  }

  if (!success) {
    // Try the other Gemma model as last resort
    const fallbackModel = GEMMA_4_MODELS.find((m) => m !== model) ?? model;
    console.log("[gemma4] falling back to", fallbackModel);
    const fallbackConfig = { ...config };
    delete fallbackConfig.thinkingConfig;
    success = await attemptStream(fallbackModel, fallbackConfig);
  }

  if (!success) {
    // Do NOT write an apology or close the writer here — the caller is
    // responsible for triggering failover to another model. Returning false
    // signals "this provider could not produce a response".
    return { success: false };
  }

  // Send SSE termination on success only.
  await writer.write(encoder.encode("data: [DONE]\n\n"));
  await writer.close();
  return { success: true };
}
