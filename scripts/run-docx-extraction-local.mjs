#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";

function parseArgs(argv) {
  let filePath = null;
  let timeoutMs = Number(process.env.DOCUMENT_DOCX_TIMEOUT_MS || 12000);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--file" && i + 1 < argv.length) {
      filePath = argv[++i];
      continue;
    }
    if (arg === "--timeout" && i + 1 < argv.length) {
      timeoutMs = Number(argv[++i]);
      continue;
    }
  }

  if (!filePath) {
    throw new Error("Missing required --file argument");
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    timeoutMs = 12000;
  }

  timeoutMs = Math.max(1000, Math.floor(timeoutMs));

  return { filePath, timeoutMs };
}

async function extractDocxWithTimeout(fileBuffer, timeoutMs) {
  let timer = null;
  const started = Date.now();

  try {
    const result = await Promise.race([
      mammoth.extractRawText({ buffer: fileBuffer }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("DOCX_MAMMOTH_TIMEOUT")), timeoutMs);
      }),
    ]);

    const text = String(result?.value ?? "").trim();
    return {
      method: "docx_mammoth_raw",
      text,
      elapsed_ms: Date.now() - started,
      messages: Array.isArray(result?.messages) ? result.messages : [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      method: message === "DOCX_MAMMOTH_TIMEOUT" ? "docx_mammoth_timeout" : "docx_mammoth_error",
      text: "",
      elapsed_ms: Date.now() - started,
      error: message,
      messages: [],
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  const { filePath, timeoutMs } = parseArgs(process.argv.slice(2));
  const absolutePath = path.resolve(filePath);
  const fileBuffer = await fs.readFile(absolutePath);

  const result = await extractDocxWithTimeout(fileBuffer, timeoutMs);

  console.log(JSON.stringify({
    file: absolutePath,
    timeout_ms: timeoutMs,
    method: result.method,
    elapsed_ms: result.elapsed_ms,
    text_length: result.text.length,
    text_preview: result.text.slice(0, 1000),
    error: result.error ?? null,
    messages: result.messages,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
