#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createWorker } from "tesseract.js";

function parseArgs(argv) {
  let filePath = null;
  let langs = String(process.env.DOCUMENT_OCR_LANGS || "srp_latn+srp+eng").trim();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--file" && i + 1 < argv.length) {
      filePath = argv[++i];
      continue;
    }
    if (arg === "--langs" && i + 1 < argv.length) {
      langs = argv[++i];
      continue;
    }
  }

  if (!filePath) throw new Error("Missing required --file argument");
  if (!langs) langs = "eng";

  return { filePath, langs: langs.replace(/,/g, "+").replace(/\s+/g, "") };
}

async function main() {
  const { filePath, langs } = parseArgs(process.argv.slice(2));
  const absolutePath = path.resolve(filePath);
  const image = await fs.readFile(absolutePath);

  const started = Date.now();
  let worker = null;
  try {
    worker = await createWorker(langs);
    const ret = await worker.recognize(image);

    const text = String(ret?.data?.text ?? "").trim();
    const confidence = typeof ret?.data?.confidence === "number" ? ret.data.confidence : null;

    console.log(JSON.stringify({
      file: absolutePath,
      langs,
      elapsed_ms: Date.now() - started,
      text_length: text.length,
      confidence,
      text_preview: text.slice(0, 1200),
      ok: true,
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      file: absolutePath,
      langs,
      elapsed_ms: Date.now() - started,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // ignore terminate failures
      }
    }
  }
}

main();
