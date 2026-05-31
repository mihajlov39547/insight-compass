// @ts-nocheck
// Failover utilities for the chat edge function.
//
// When a model returns an explicit failure (HTTP non-2xx) OR the streamed
// content matches "unavailable/temporarily/switch to another model" style
// apology messages, we transparently retry with a plan-appropriate model.
//
// Failover order (after the originally selected model):
//   1. Primary fallback: free => openai/gpt-5-mini, basic/premium/enterprise => google/gemini-3.5-flash
//   2. Random pick from any remaining models available on the user's plan

// Gateway chat models eligible for failover (excludes specialized providers
// like gemma-4 / gemini-3.1 which require dedicated routing).
const GATEWAY_CHAT_MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-3.5-flash",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-pro",
  "openai/gpt-5-mini",
  "openai/gpt-5",
  "openai/gpt-5.2",
];

// Mirrors src/lib/planLimits.ts (restricted IDs that overlap the gateway set).
const PLAN_RESTRICTED: Record<string, string[]> = {
  free: ["openai/gpt-5", "openai/gpt-5.2", "google/gemini-3.5-flash"],
  basic: ["openai/gpt-5", "openai/gpt-5.2"],
  premium: [],
  enterprise: [],
};

export function availableGatewayModelsForPlan(plan: string): string[] {
  const restricted = PLAN_RESTRICTED[plan] ?? [];
  return GATEWAY_CHAT_MODELS.filter((m) => !restricted.includes(m));
}

function primaryFallbackForPlan(plan: string): string {
  return plan === "free" ? "openai/gpt-5-mini" : "google/gemini-3.5-flash";
}

/**
 * Build the failover chain. `initialModel` may be a specialized provider
 * (e.g. "gemma-4") that isn't in the gateway list — it's still placed first.
 */
export function buildFailoverChain(initialModel: string, plan: string): string[] {
  const avail = availableGatewayModelsForPlan(plan);
  const primary = primaryFallbackForPlan(plan);
  const chain: string[] = [initialModel];

  if (primary !== initialModel && avail.includes(primary)) {
    chain.push(primary);
  }

  const remaining = avail.filter((m) => !chain.includes(m));
  if (remaining.length > 0) {
    const random = remaining[Math.floor(Math.random() * remaining.length)];
    chain.push(random);
  }

  return chain;
}

// Phrases that indicate the upstream model returned an availability apology
// rather than a real answer. Matched case-insensitively against streamed
// assistant delta content.
const UNAVAILABLE_PATTERNS = [
  /temporarily unavailable/i,
  /currently unavailable/i,
  /\bswitch to another model\b/i,
  /\bis unavailable\b/i,
  /encountered an error/i,
  /model is overloaded/i,
];

export function contentSignalsUnavailable(content: string): boolean {
  if (!content) return false;
  return UNAVAILABLE_PATTERNS.some((re) => re.test(content));
}

/**
 * Extract assistant `delta.content` text from a raw SSE chunk buffer.
 * Tolerant of partial frames — incomplete trailing lines are ignored.
 */
export function extractDeltaContent(buffer: string): string {
  let out = "";
  for (const rawLine of buffer.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload);
      const c = parsed?.choices?.[0]?.delta?.content;
      if (typeof c === "string") out += c;
    } catch {
      // partial JSON, ignore
    }
  }
  return out;
}

export interface GatewayAttemptResult {
  ok: boolean;
  stream?: ReadableStream<Uint8Array>;
  status?: number;
  reason?: string;
}

export interface GatewayAttemptOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: any[];
  responseMaxOutputTokens: number;
  // How much streamed text to sniff for the unavailability check before
  // committing to passthrough. ~600 chars is enough for the typical apology
  // sentence while keeping latency minimal.
  sniffChars?: number;
}

/**
 * Attempt one model via the Lovable AI gateway. Sniffs the leading content
 * for unavailability signals before returning a passthrough ReadableStream
 * so failover can kick in transparently.
 */
export async function attemptGatewayStream(
  opts: GatewayAttemptOptions,
): Promise<GatewayAttemptResult> {
  const isOpenAI = opts.model.startsWith("openai/");
  const isReasoning =
    isOpenAI ||
    opts.model.includes("gemini-2.5-pro") ||
    opts.model.includes("gemini-3");
  const multiplier = isReasoning ? 6 : 1;
  const floor = isReasoning ? 2048 : 0;
  const effectiveMaxTokens = Math.max(
    opts.responseMaxOutputTokens * multiplier,
    floor || opts.responseMaxOutputTokens,
  );
  const tokenField = isOpenAI
    ? { max_completion_tokens: effectiveMaxTokens }
    : { max_tokens: effectiveMaxTokens };

  let response: Response;
  try {
    response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: "system", content: opts.systemPrompt }, ...opts.messages],
        ...tokenField,
        stream: true,
      }),
    });
  } catch (e) {
    return { ok: false, reason: `fetch-error: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!response.ok) {
    // Bubble up 429/402 unchanged — caller handles them specially.
    if (response.status === 429 || response.status === 402) {
      return { ok: false, status: response.status, reason: `http-${response.status}` };
    }
    return { ok: false, status: response.status, reason: `http-${response.status}` };
  }

  if (!response.body) {
    return { ok: false, reason: "no-body" };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const sniffLimit = opts.sniffChars ?? 600;
  const buffered: Uint8Array[] = [];
  let rawBuffer = "";
  let contentSeen = "";

  // Sniff up to sniffLimit chars of delta content (not raw bytes) before
  // deciding whether to proceed with this model.
  while (contentSeen.length < sniffLimit) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered.push(value);
    rawBuffer += decoder.decode(value, { stream: true });
    contentSeen = extractDeltaContent(rawBuffer);
    if (contentSignalsUnavailable(contentSeen)) {
      try { await reader.cancel(); } catch { /* noop */ }
      return { ok: false, reason: `unavailable-text: ${contentSeen.slice(0, 120)}` };
    }
  }

  // Looks healthy — return a passthrough stream that replays buffered chunks
  // followed by the remainder of the upstream response.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of buffered) controller.enqueue(chunk);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) controller.enqueue(value);
        }
      } catch (e) {
        console.error("[failover] passthrough read error", e);
      } finally {
        controller.close();
      }
    },
    cancel() {
      try { reader.cancel(); } catch { /* noop */ }
    },
  });

  return { ok: true, stream };
}
