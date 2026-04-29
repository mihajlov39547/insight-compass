// @ts-nocheck
// Tavily Research streaming proxy.
//
// Calls POST https://api.tavily.com/research with stream: true and forwards
// a normalized event stream to the client. Tavily emits OpenAI-shaped chunks
// (delta.tool_calls, delta.content, delta.sources) terminated by `event: done`.
// We re-emit them as our own protocol on top of SSE so the frontend does not
// have to know about Tavily-specific shapes.
//
// Output protocol (line-delimited JSON, one event per `data: ` line):
//   { type: "status",  label: string, detail?: string }
//   { type: "tool",    name: string, queries?: string[] }   // tool_call event
//   { type: "tool_result", name: string, sources?: SourceItem[] }
//   { type: "content_delta", text: string }
//   { type: "sources", sources: SourceItem[] }
//   { type: "done",    finalText?: string }
//   { type: "error",   message: string }
//
// SourceItem = { title?: string; url: string; favicon?: string | null; domain?: string }
//
// The shared chat path (`/functions/v1/chat`) is NOT used in research mode.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser } from "../_shared/auth/require-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TAVILY_RESEARCH_URL = "https://api.tavily.com/research";
const VALID_MODELS = new Set(["mini", "pro", "auto"]);
const DEFAULT_MODEL = "auto";
const MAX_INPUT_LENGTH = 4000;

interface SourceItem {
  title?: string;
  url: string;
  favicon?: string | null;
  domain?: string;
}

function safeDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function normalizeSources(raw: unknown): SourceItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SourceItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const url = typeof (r as any).url === "string" ? (r as any).url.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      title: typeof (r as any).title === "string" ? (r as any).title : undefined,
      favicon: typeof (r as any).favicon === "string" ? (r as any).favicon : null,
      domain: safeDomain(url),
    });
  }
  return out;
}

function sseFrame(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function getResponseLanguageInstruction(value: unknown): string {
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (code.startsWith("sr")) {
    return "Write the final answer in Serbian using Latin script. Use Serbian even if the user question or sources are in another language. Translate and summarize source information into Serbian unless the user explicitly asks for a verbatim quote.";
  }
  return "Write the final answer in English. Use English even if the user question or sources are in another language. Translate and summarize source information into English unless the user explicitly asks for a verbatim quote.";
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

  const auth = await requireUser(req, corsHeaders);
  if ("response" in auth) return auth.response;

  const apiKey = Deno.env.get("TAVILY_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "TAVILY_API_KEY is not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const rawInput = typeof body?.input === "string" ? body.input.trim() : "";
  if (!rawInput) {
    return new Response(
      JSON.stringify({ error: "input is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  if (rawInput.length > MAX_INPUT_LENGTH) {
    return new Response(
      JSON.stringify({ error: `input must be <= ${MAX_INPUT_LENGTH} chars` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const requestedModel = typeof body?.model === "string" ? body.model.trim().toLowerCase() : "";
  const model = VALID_MODELS.has(requestedModel) ? requestedModel : DEFAULT_MODEL;
  const inputWithLanguageInstruction = `${getResponseLanguageInstruction(body?.responseLanguage)}\n\n${rawInput}`;

  // Always stream from Tavily; we re-stream to client.
  let upstream: Response;
  try {
    upstream = await fetch(TAVILY_RESEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        input: inputWithLanguageInstruction,
        model,
        stream: true,
        citation_format: "numbered",
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tavily-research] upstream fetch failed:", message);
    return new Response(
      JSON.stringify({ error: `Tavily research request failed: ${message}` }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    console.error("[tavily-research] non-OK upstream", upstream.status, errText.slice(0, 500));
    let userMessage = "Research request failed";
    if (upstream.status === 401) userMessage = "Tavily authentication failed";
    else if (upstream.status === 429) userMessage = "Tavily rate limit reached. Try again shortly.";
    else if (upstream.status === 432) userMessage = "Tavily plan/key limit reached.";
    return new Response(
      JSON.stringify({ error: userMessage, upstreamStatus: upstream.status }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!upstream.body) {
    return new Response(
      JSON.stringify({ error: "Tavily returned an empty stream" }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Re-stream: parse Tavily SSE, emit normalized events.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";
      let fullText = "";
      const allSources: SourceItem[] = [];
      const seenSourceUrls = new Set<string>();

      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseFrame(payload)));
      };

      const mergeSources = (incoming: SourceItem[]) => {
        for (const s of incoming) {
          if (!seenSourceUrls.has(s.url)) {
            seenSourceUrls.add(s.url);
            allSources.push(s);
          }
        }
      };

      send({ type: "status", label: "Researching..." });

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by blank lines.
          let sepIdx: number;
          while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
            const rawFrame = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);

            const lines = rawFrame.split("\n");
            let eventName = "";
            let dataLine = "";
            for (const line of lines) {
              if (line.startsWith("event:")) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                dataLine += (dataLine ? "\n" : "") + line.slice(5).trim();
              }
            }

            if (eventName === "done") {
              // Tavily explicit done event.
              send({ type: "done", finalText: fullText });
              continue;
            }

            if (!dataLine) continue;
            if (dataLine === "[DONE]") {
              send({ type: "done", finalText: fullText });
              continue;
            }

            let parsed: any = null;
            try {
              parsed = JSON.parse(dataLine);
            } catch {
              // Skip malformed frames; keep streaming.
              continue;
            }

            if (parsed?.object === "error" || typeof parsed?.error === "string") {
              const message = typeof parsed.error === "string" ? parsed.error : "Tavily research error";
              send({ type: "error", message });
              continue;
            }

            const delta = parsed?.choices?.[0]?.delta;
            if (!delta) continue;

            // 1. Tool calls (planning / search / generating).
            if (delta.tool_calls && typeof delta.tool_calls === "object") {
              const tc = delta.tool_calls;
              const kind = tc.type;
              const list = Array.isArray(tc.tool_call)
                ? tc.tool_call
                : Array.isArray(tc.tool_response)
                  ? tc.tool_response
                  : [];

              for (const item of list) {
                const name = typeof item?.name === "string" ? item.name : "Tool";
                if (kind === "tool_call") {
                  const queries = Array.isArray(item?.queries) ? item.queries.filter((q: unknown) => typeof q === "string") : undefined;
                  send({ type: "tool", name, queries });
                  // Friendly status mapping for the simple "spinner + label" UI.
                  if (name === "Planning") send({ type: "status", label: "Planning research" });
                  else if (name === "WebSearch") send({ type: "status", label: "Searching the web" });
                  else if (name === "ResearchSubtopic") send({ type: "status", label: "Researching subtopic" });
                  else if (name === "Generating") send({ type: "status", label: "Writing report" });
                } else if (kind === "tool_response") {
                  const sources = normalizeSources(item?.sources);
                  if (sources.length > 0) {
                    mergeSources(sources);
                    send({ type: "tool_result", name, sources });
                  }
                }
              }
              continue;
            }

            // 2. Content delta — string chunks of the final report.
            if (typeof delta.content === "string" && delta.content.length > 0) {
              fullText += delta.content;
              send({ type: "content_delta", text: delta.content });
              continue;
            }

            // 3. Final consolidated sources event.
            if (Array.isArray(delta.sources)) {
              const sources = normalizeSources(delta.sources);
              if (sources.length > 0) {
                mergeSources(sources);
                send({ type: "sources", sources: allSources });
              }
            }
          }
        }

        // Final flush.
        if (allSources.length > 0) {
          send({ type: "sources", sources: allSources });
        }
        send({ type: "done", finalText: fullText });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[tavily-research] stream error:", message);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});
