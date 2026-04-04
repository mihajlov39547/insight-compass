// @ts-nocheck

import {
  extractText,
  countStats,
  normalizeForSearch,
  filterStructuralNoise,
} from "./text-extraction.ts";

function toUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function toLatin1(bytes: Uint8Array): string {
  return new TextDecoder("iso-8859-1", { fatal: false }).decode(bytes);
}

async function parseZipEntryText(zipBytes: Uint8Array, targetPath: string): Promise<string | null> {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);

  let eocdOffset = -1;
  for (let i = zipBytes.length - 22; i >= Math.max(0, zipBytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdEntries = view.getUint16(eocdOffset + 10, true);

  let offset = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (offset + 46 > zipBytes.length) break;
    if (view.getUint32(offset, true) !== 0x02014b50) break;

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const fileName = new TextDecoder().decode(zipBytes.subarray(offset + 46, offset + 46 + fileNameLen));

    if (fileName === targetPath) {
      const lfhOffset = localHeaderOffset;
      if (lfhOffset + 30 > zipBytes.length) return null;
      const lfhFileNameLen = view.getUint16(lfhOffset + 26, true);
      const lfhExtraLen = view.getUint16(lfhOffset + 28, true);
      const dataStart = lfhOffset + 30 + lfhFileNameLen + lfhExtraLen;
      const compressedData = zipBytes.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        return new TextDecoder("utf-8", { fatal: false }).decode(compressedData);
      }

      if (compressionMethod === 8) {
        try {
          const ds = new DecompressionStream("deflate-raw" as CompressionFormat);
          const writer = ds.writable.getWriter();
          const reader = ds.readable.getReader();

          const chunks: Uint8Array[] = [];
          const readAll = (async () => {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
          })();

          await writer.write(new Uint8Array(compressedData.buffer as ArrayBuffer));
          await writer.close();
          await readAll;

          const totalLen = chunks.reduce((s, c) => s + c.length, 0);
          const out = new Uint8Array(totalLen);
          let pos = 0;
          for (const chunk of chunks) {
            out.set(chunk, pos);
            pos += chunk.length;
          }

          return new TextDecoder("utf-8", { fatal: false }).decode(out);
        } catch {
          return null;
        }
      }

      return null;
    }

    offset += 46 + fileNameLen + extraLen + commentLen;
  }

  return null;
}

export async function extractPdfTextNonAi(bytes: Uint8Array, mimeType: string, fileName: string) {
  const result = await extractText(bytes, mimeType, fileName);
  return {
    text: result.text,
    method: result.method,
    quality_score: result.quality.score,
    quality_reason: result.quality.reason,
  };
}

export async function extractDocxTextNonAi(bytes: Uint8Array, mimeType: string, fileName: string) {
  const result = await extractText(bytes, mimeType, fileName);
  return {
    text: result.text,
    method: result.method,
    quality_score: result.quality.score,
    quality_reason: result.quality.reason,
  };
}

export async function extractDocTextNonAi(bytes: Uint8Array, mimeType: string, fileName: string) {
  const result = await extractText(bytes, mimeType, fileName);
  return {
    text: result.text,
    method: result.method,
    quality_score: result.quality.score,
    quality_reason: result.quality.reason,
  };
}

export async function extractSpreadsheetTextNonAi(bytes: Uint8Array, fileName: string) {
  const ext = (fileName.split(".").pop() || "").toLowerCase();

  if (ext === "csv") {
    const text = toUtf8(bytes);
    const rows = text.split(/\r?\n/).filter(Boolean);
    const cols = rows[0]?.split(",").length ?? 0;
    return {
      text,
      sheet_count: 1,
      row_count: rows.length,
      column_count_estimate: cols,
      method: "csv_plaintext",
      warning: null,
    };
  }

  if (ext === "xlsx" || ext === "xls") {
    try {
      const XLSX = await import("https://esm.sh/xlsx@0.18.5?target=es2022");
      const workbook = XLSX.read(bytes, { type: "array" });
      const sheetNames = workbook.SheetNames || [];

      const texts: string[] = [];
      let rowCount = 0;
      for (const sheetName of sheetNames.slice(0, 20)) {
        const ws = workbook.Sheets[sheetName];
        if (!ws) continue;
        const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
        texts.push(`Sheet: ${sheetName}\n${csv}`);
        rowCount += csv.split(/\r?\n/).filter(Boolean).length;
      }

      return {
        text: texts.join("\n\n"),
        sheet_count: sheetNames.length,
        row_count: rowCount,
        column_count_estimate: null,
        method: "xlsx_package",
        warning: null,
      };
    } catch (error) {
      const fallback = toUtf8(bytes).slice(0, 50000);
      return {
        text: fallback,
        sheet_count: null,
        row_count: null,
        column_count_estimate: null,
        method: "xlsx_fallback_decode",
        warning: error instanceof Error ? error.message : "XLSX parser import failed",
      };
    }
  }

  return {
    text: "",
    sheet_count: null,
    row_count: null,
    column_count_estimate: null,
    method: "spreadsheet_unsupported",
    warning: "Unsupported spreadsheet extension",
  };
}

export async function extractPresentationTextNonAi(bytes: Uint8Array, fileName: string) {
  const ext = (fileName.split(".").pop() || "").toLowerCase();

  if (ext === "pptx") {
    const slideTexts: string[] = [];
    let slideIndex = 1;

    while (true) {
      const entry = await parseZipEntryText(bytes, `ppt/slides/slide${slideIndex}.xml`);
      if (!entry) break;
      const textNodes = Array.from(entry.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)).map((m) => m[1]);
      if (textNodes.length > 0) {
        slideTexts.push(`Slide ${slideIndex}: ${textNodes.join(" ")}`);
      }
      slideIndex += 1;
      if (slideIndex > 200) break;
    }

    return {
      text: slideTexts.join("\n\n"),
      slide_count: slideIndex - 1,
      method: "pptx_zip_xml",
      warning: slideTexts.length === 0 ? "No text runs found in PPTX slides" : null,
    };
  }

  if (ext === "ppt") {
    return {
      text: "",
      slide_count: null,
      method: "ppt_binary_not_supported",
      warning: "Legacy PPT extraction is not supported in Edge runtime without external parser service",
    };
  }

  return {
    text: "",
    slide_count: null,
    method: "presentation_unsupported",
    warning: "Unsupported presentation extension",
  };
}

export function extractEmailTextNonAi(bytes: Uint8Array) {
  const raw = toUtf8(bytes) || toLatin1(bytes);
  const splitIndex = raw.search(/\r?\n\r?\n/);
  const headerText = splitIndex >= 0 ? raw.slice(0, splitIndex) : "";
  const bodyText = splitIndex >= 0 ? raw.slice(splitIndex).trim() : raw;

  const subjectMatch = headerText.match(/^Subject:\s*(.*)$/gim);
  const fromMatch = headerText.match(/^From:\s*(.*)$/gim);
  const dateMatch = headerText.match(/^Date:\s*(.*)$/gim);

  const textPlainPart = bodyText.match(/Content-Type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(\r?\n--|$)/i);
  const selectedBody = textPlainPart ? textPlainPart[1].trim() : bodyText;

  return {
    text: selectedBody,
    subject: subjectMatch ? subjectMatch[0].replace(/^Subject:\s*/i, "").trim() : null,
    from: fromMatch ? fromMatch[0].replace(/^From:\s*/i, "").trim() : null,
    date: dateMatch ? dateMatch[0].replace(/^Date:\s*/i, "").trim() : null,
    method: "eml_header_body_parser",
  };
}

export function extractPlainTextLikeContent(bytes: Uint8Array, fileName: string) {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  const text = toUtf8(bytes);

  if (["txt", "md", "json", "xml", "csv", "rtf", "log"].includes(ext)) {
    const normalized = text.replace(/\u0000/g, "").trim();
    const stats = countStats(normalized);
    return {
      text: normalized,
      method: "plain_text_like",
      word_count: stats.word_count,
      char_count: stats.char_count,
      normalized_search_text: normalizeForSearch(normalized, fileName),
      warning: null,
    };
  }

  return {
    text: "",
    method: "plain_text_like_unsupported",
    word_count: 0,
    char_count: 0,
    normalized_search_text: "",
    warning: "Extension is not in plain-text-like allowlist",
  };
}

export function normalizeTechnicalAnalysisOutput(
  raw: Record<string, unknown>,
  fileName: string
): Record<string, unknown> {
  const extractedText = typeof raw.extracted_text === "string"
    ? raw.extracted_text
    : typeof raw.text === "string"
      ? raw.text
      : "";

  const cleaned = filterStructuralNoise(extractedText);
  const effectiveText = cleaned.length > 50 ? cleaned : extractedText;
  const stats = countStats(effectiveText);

  return {
    normalized_extracted_text: effectiveText,
    normalized_text_length: effectiveText.length,
    normalized_search_text: normalizeForSearch(effectiveText, fileName),
    word_count: stats.word_count,
    char_count: stats.char_count,
    line_count: stats.line_count,
    warning: raw.warning ?? null,
  };
}
