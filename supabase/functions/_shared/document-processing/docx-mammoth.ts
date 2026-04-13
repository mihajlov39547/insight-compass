// @ts-nocheck
import { Buffer } from "node:buffer";

export type DocxMammothMethod =
  | "docx_mammoth_raw"
  | "docx_mammoth_timeout"
  | "docx_mammoth_error";

export interface DocxMammothResult {
  text: string;
  method: DocxMammothMethod;
  durationMs: number;
  error?: string;
}

export interface DocxMammothOptions {
  timeoutMs?: number;
  extractRawText?: (input: { buffer?: Buffer; arrayBuffer?: ArrayBuffer }) => Promise<{ value?: unknown }>;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 12000;

function resolveTimeoutMs(value?: number): number {
  if (!Number.isFinite(value) || Number(value) <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(1000, Math.floor(Number(value)));
}

async function defaultExtractRawText(input: { buffer?: Buffer; arrayBuffer?: ArrayBuffer }): Promise<{ value?: unknown }> {
  const mammothMod: any = await import("https://esm.sh/mammoth@1.12.0?target=es2022");
  const mammoth = mammothMod?.default ?? mammothMod;
  if (!mammoth || typeof mammoth.extractRawText !== "function") {
    throw new Error("Mammoth extractRawText is unavailable");
  }
  return mammoth.extractRawText(input);
}

export async function extractDocxRawTextWithMammoth(
  bytes: Uint8Array,
  options: DocxMammothOptions = {},
): Promise<DocxMammothResult> {
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const now = options.now ?? Date.now;
  const startedAt = now();
  const extractRawText = options.extractRawText ?? defaultExtractRawText;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const runWithTimeout = async (input: { buffer?: Buffer; arrayBuffer?: ArrayBuffer }) => {
    return await Promise.race([
      extractRawText(input),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("DOCX_MAMMOTH_TIMEOUT")), timeoutMs);
      }),
    ]);
  };

  const arrayBufferInput = bytes.slice().buffer;
  const fallbackBufferInput = Buffer.from(bytes);
  let lastError: unknown = null;

  try {
    const firstResult = await runWithTimeout({ arrayBuffer: arrayBufferInput });
    const text = String(firstResult?.value ?? "").trim();
    return {
      text,
      method: "docx_mammoth_raw",
      durationMs: now() - startedAt,
    };
  } catch (firstError) {
    lastError = firstError;
    const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
    if (firstMessage === "DOCX_MAMMOTH_TIMEOUT") {
      return {
        text: "",
        method: "docx_mammoth_timeout",
        durationMs: now() - startedAt,
        error: firstMessage,
      };
    }
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  }

  try {
    const secondResult = await runWithTimeout({ buffer: fallbackBufferInput });
    const text = String(secondResult?.value ?? "").trim();
    return {
      text,
      method: "docx_mammoth_raw",
      durationMs: now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "DOCX_MAMMOTH_TIMEOUT") {
      return {
        text: "",
        method: "docx_mammoth_timeout",
        durationMs: now() - startedAt,
        error: message,
      };
    }

    return {
      text: "",
      method: "docx_mammoth_error",
      durationMs: now() - startedAt,
      error: message || (lastError instanceof Error ? lastError.message : String(lastError ?? "Unknown DOCX extraction error")),
    };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
