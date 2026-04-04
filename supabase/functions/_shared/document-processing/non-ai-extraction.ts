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

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function extractXmlTextNodes(xml: string, tagRegex: RegExp): string {
  const parts = Array.from(xml.matchAll(tagRegex)).map((m) => (m[1] || "").trim()).filter(Boolean);
  return normalizeWhitespace(parts.join(" "));
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
  const parserWarnings: string[] = [];

  if (ext === "pptx") {
    const slideTexts: string[] = [];
    const notesTexts: string[] = [];
    let slideIndex = 1;

    while (true) {
      const entry = await parseZipEntryText(bytes, `ppt/slides/slide${slideIndex}.xml`);
      if (!entry) break;
      const slideText = extractXmlTextNodes(entry, /<a:t[^>]*>([^<]*)<\/a:t>/g);
      if (slideText) {
        slideTexts.push(`Slide ${slideIndex}: ${slideText}`);
      }

      const noteEntry = await parseZipEntryText(bytes, `ppt/notesSlides/notesSlide${slideIndex}.xml`);
      if (noteEntry) {
        const notesText = extractXmlTextNodes(noteEntry, /<a:t[^>]*>([^<]*)<\/a:t>/g);
        if (notesText) {
          notesTexts.push(`Notes ${slideIndex}: ${notesText}`);
        }
      }

      slideIndex += 1;
      if (slideIndex > 200) break;
    }

    if (slideTexts.length === 0) {
      parserWarnings.push("No slide text runs found in PPTX slides");
    }

    const fullText = [
      ...slideTexts,
      ...notesTexts,
    ].join("\n\n").trim();

    return {
      text: fullText,
      extracted_text: fullText,
      extracted_text_length: fullText.length,
      slide_count: slideIndex - 1,
      notes_count: notesTexts.length,
      presentation_type: "pptx",
      support_status: "supported",
      method: "pptx_zip_xml_slides_notes",
      parser_warnings: parserWarnings,
      warning: parserWarnings.length > 0 ? parserWarnings.join(" | ") : null,
    };
  }

  if (ext === "ppt") {
    const parserServiceUrl = Deno.env.get("PPT_PARSER_SERVICE_URL") || Deno.env.get("NON_AI_PARSER_SERVICE_URL");
    const parserServiceToken = Deno.env.get("PPT_PARSER_SERVICE_TOKEN") || Deno.env.get("NON_AI_PARSER_SERVICE_TOKEN");

    if (parserServiceUrl) {
      try {
        const resp = await fetch(parserServiceUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(parserServiceToken ? { Authorization: `Bearer ${parserServiceToken}` } : {}),
          },
          body: JSON.stringify({
            file_base64: bytesToBase64(bytes),
            format: "ppt",
          }),
        });

        if (resp.ok) {
          const data = await resp.json();
          const text = normalizeWhitespace(String(data?.text || ""));
          const warnings = Array.isArray(data?.warnings)
            ? data.warnings.filter((w: any) => typeof w === "string")
            : [];

          return {
            text,
            extracted_text: text,
            extracted_text_length: text.length,
            slide_count: typeof data?.slide_count === "number" ? data.slide_count : null,
            notes_count: null,
            presentation_type: "ppt",
            support_status: text ? "partial" : "deferred",
            method: "ppt_external_parser_service",
            parser_warnings: warnings,
            warning: warnings.length > 0 ? warnings.join(" | ") : null,
          };
        }

        parserWarnings.push(`PPT parser service failed (${resp.status})`);
      } catch (error) {
        parserWarnings.push(error instanceof Error ? error.message : "PPT parser service execution error");
      }
    }

    parserWarnings.push("Legacy PPT extraction is not fully supported in Edge runtime without a dedicated parser/conversion worker");
    return {
      text: "",
      extracted_text: "",
      extracted_text_length: 0,
      slide_count: null,
      notes_count: null,
      presentation_type: "ppt",
      support_status: "deferred",
      method: "ppt_binary_deferred",
      parser_warnings: parserWarnings,
      warning: parserWarnings.join(" | "),
    };
  }

  return {
    text: "",
    extracted_text: "",
    extracted_text_length: 0,
    slide_count: null,
    notes_count: null,
    presentation_type: "unknown",
    support_status: "unsupported",
    method: "presentation_unsupported",
    parser_warnings: ["Unsupported presentation extension"],
    warning: "Unsupported presentation extension",
  };
}

function fallbackParseEml(raw: string) {
  const splitIndex = raw.search(/\r?\n\r?\n/);
  const headerText = splitIndex >= 0 ? raw.slice(0, splitIndex) : "";
  const bodyText = splitIndex >= 0 ? raw.slice(splitIndex).trim() : raw;

  const subjectMatch = headerText.match(/^Subject:\s*(.*)$/gim);
  const fromMatch = headerText.match(/^From:\s*(.*)$/gim);
  const dateMatch = headerText.match(/^Date:\s*(.*)$/gim);

  const textPlainPart = bodyText.match(/Content-Type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(\r?\n--|$)/i);
  const selectedBody = textPlainPart ? textPlainPart[1].trim() : bodyText;

  return {
    body_text: selectedBody,
    body_html: null,
    has_html: false,
    subject: subjectMatch ? subjectMatch[0].replace(/^Subject:\s*/i, "").trim() : null,
    from: fromMatch ? fromMatch[0].replace(/^From:\s*/i, "").trim() : null,
    to: null,
    cc: null,
    bcc: null,
    date: dateMatch ? dateMatch[0].replace(/^Date:\s*/i, "").trim() : null,
    sent_date: dateMatch ? dateMatch[0].replace(/^Date:\s*/i, "").trim() : null,
    attachment_count: 0,
    attachments: [],
    method: "eml_fallback_header_body_parser",
    parser_warnings: ["mailparser unavailable; fallback parser used"],
  };
}

function flattenAddress(value: any): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value?.text === "string") return value.text.trim() || null;
  return null;
}

export async function extractEmailTextNonAi(
  bytes: Uint8Array,
  fileName: string,
  mimeType?: string | null
) {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  const parserWarnings: string[] = [];

  if (ext === "eml" || String(mimeType || "").includes("message/rfc822")) {
    try {
      const mailparserMod = await import("https://esm.sh/mailparser@3.7.2?target=es2022");
      const simpleParser = mailparserMod.simpleParser;
      if (typeof simpleParser !== "function") {
        throw new Error("mailparser simpleParser is unavailable");
      }

      const raw = toUtf8(bytes) || toLatin1(bytes);
      const parsed = await simpleParser(raw);
      const bodyText = String(parsed?.text || "").trim();
      const bodyHtml = typeof parsed?.html === "string" ? parsed.html : null;
      const attachments = Array.isArray(parsed?.attachments)
        ? parsed.attachments.map((a: any) => ({
            name: typeof a?.filename === "string" ? a.filename : null,
            mime_type: typeof a?.contentType === "string" ? a.contentType : null,
            size_bytes: typeof a?.size === "number" ? a.size : null,
          }))
        : [];

      return {
        text: bodyText,
        body_text: bodyText,
        body_html: bodyHtml,
        has_html: Boolean(bodyHtml),
        subject: typeof parsed?.subject === "string" ? parsed.subject : null,
        from: flattenAddress(parsed?.from),
        to: flattenAddress(parsed?.to),
        cc: flattenAddress(parsed?.cc),
        bcc: flattenAddress(parsed?.bcc),
        date: parsed?.date ? new Date(parsed.date).toISOString() : null,
        sent_date: parsed?.date ? new Date(parsed.date).toISOString() : null,
        attachment_count: attachments.length,
        attachments,
        method: "mailparser_eml",
        support_status: "supported",
        parser_warnings: parserWarnings,
      };
    } catch (error) {
      parserWarnings.push(error instanceof Error ? error.message : "mailparser parsing failed");
      const fallback = fallbackParseEml(toUtf8(bytes) || toLatin1(bytes));
      return {
        text: fallback.body_text,
        ...fallback,
        support_status: "partial",
        parser_warnings: [...fallback.parser_warnings, ...parserWarnings],
      };
    }
  }

  if (ext === "msg") {
    try {
      const msgReaderMod = await import("https://esm.sh/@kenjiuno/msgreader@1.23.0?target=es2022");
      const MsgReader = msgReaderMod.default ?? msgReaderMod.MsgReader ?? msgReaderMod;
      const reader = new MsgReader(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      const fileData = reader.getFileData();

      const bodyText = normalizeWhitespace(String(
        fileData?.body ||
        fileData?.messageBody ||
        fileData?.bodyText ||
        ""
      ));

      const bodyHtml = typeof fileData?.bodyHTML === "string"
        ? fileData.bodyHTML
        : typeof fileData?.bodyHtml === "string"
          ? fileData.bodyHtml
          : null;

      const attachments = Array.isArray(fileData?.attachments)
        ? fileData.attachments.map((a: any) => ({
            name: typeof a?.fileName === "string" ? a.fileName : (typeof a?.name === "string" ? a.name : null),
            mime_type: typeof a?.mimeType === "string" ? a.mimeType : null,
            size_bytes: typeof a?.data?.byteLength === "number"
              ? a.data.byteLength
              : (typeof a?.size === "number" ? a.size : null),
          }))
        : [];

      return {
        text: bodyText,
        body_text: bodyText,
        body_html: bodyHtml,
        has_html: Boolean(bodyHtml),
        subject: typeof fileData?.subject === "string" ? fileData.subject : null,
        from: typeof fileData?.senderEmail === "string"
          ? fileData.senderEmail
          : (typeof fileData?.senderName === "string" ? fileData.senderName : null),
        to: typeof fileData?.recipients === "string"
          ? fileData.recipients
          : null,
        cc: typeof fileData?.cc === "string" ? fileData.cc : null,
        bcc: typeof fileData?.bcc === "string" ? fileData.bcc : null,
        date: fileData?.messageDeliveryTime
          ? new Date(fileData.messageDeliveryTime).toISOString()
          : null,
        sent_date: fileData?.messageDeliveryTime
          ? new Date(fileData.messageDeliveryTime).toISOString()
          : null,
        attachment_count: attachments.length,
        attachments,
        method: "msgreader_msg",
        support_status: "supported",
        parser_warnings: parserWarnings,
      };
    } catch (error) {
      parserWarnings.push(error instanceof Error ? error.message : "msgreader parsing failed");
      return {
        text: "",
        body_text: "",
        body_html: null,
        has_html: false,
        subject: null,
        from: null,
        to: null,
        cc: null,
        bcc: null,
        date: null,
        sent_date: null,
        attachment_count: 0,
        attachments: [],
        method: "msgreader_failed",
        support_status: "partial",
        parser_warnings: parserWarnings,
      };
    }
  }

  return {
    text: "",
    body_text: "",
    body_html: null,
    has_html: false,
    subject: null,
    from: null,
    to: null,
    cc: null,
    bcc: null,
    date: null,
    sent_date: null,
    attachment_count: 0,
    attachments: [],
    method: "email_unsupported",
    support_status: "unsupported",
    parser_warnings: ["Unsupported email extension"],
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
