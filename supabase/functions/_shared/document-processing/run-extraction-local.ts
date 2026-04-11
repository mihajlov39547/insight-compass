// @ts-nocheck
import { basename, extname } from "https://deno.land/std@0.224.0/path/mod.ts";
import { extractText } from "./text-extraction.ts";

function inferMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".txt":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".csv":
      return "text/csv";
    case ".rtf":
      return "application/rtf";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default:
      return "application/octet-stream";
  }
}

function parseArgs(args: string[]): { filePath: string; mimeType: string | null } {
  let filePath: string | null = null;
  let mimeType: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--file" && i + 1 < args.length) {
      filePath = args[++i];
      continue;
    }
    if (arg === "--mime" && i + 1 < args.length) {
      mimeType = args[++i];
      continue;
    }
  }

  if (!filePath) {
    throw new Error("Missing required --file argument");
  }

  return { filePath, mimeType };
}

if (import.meta.main) {
  try {
    const { filePath, mimeType } = parseArgs(Deno.args);
    const bytes = await Deno.readFile(filePath);
    const fileName = basename(filePath);
    const resolvedMime = mimeType || inferMimeType(filePath);

    const started = Date.now();
    const result = await extractText(bytes, resolvedMime, fileName);
    const elapsedMs = Date.now() - started;

    const output = {
      file: filePath,
      mime_type: resolvedMime,
      file_name: fileName,
      elapsed_ms: elapsedMs,
      method: result.method,
      encoding: result.encoding || null,
      quality: result.quality,
      text_length: result.text.length,
      text_preview: result.text.slice(0, 800),
    };

    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    Deno.exit(1);
  }
}
