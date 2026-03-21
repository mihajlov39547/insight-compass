import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import pako from "https://esm.sh/pako@2.1.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── PDF Text Extraction ───────────────────────────────────────────────

function extractPdfText(bytes: Uint8Array): { text: string; method: string } {
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  // Method 1: Decompress FlateDecode streams and extract text operators
  const decompressedText = extractFromCompressedStreams(bytes, raw);
  if (decompressedText && assessTextQuality(decompressedText).readable) {
    return { text: decompressedText, method: "flatedecode_decompress" };
  }

  // Method 2: Direct text operator extraction (uncompressed PDFs)
  const directText = extractTextOperators(raw);
  if (directText && assessTextQuality(directText).readable) {
    return { text: directText, method: "direct_text_operators" };
  }

  // Method 3: Extract from ToUnicode CMaps + text operators
  const cmapText = extractWithCMap(raw);
  if (cmapText && assessTextQuality(cmapText).readable) {
    return { text: cmapText, method: "cmap_extraction" };
  }

  // No usable text found
  return { text: "", method: "none" };
}

function extractFromCompressedStreams(bytes: Uint8Array, raw: string): string {
  const textParts: string[] = [];

  try {
    // Find all stream positions in the raw bytes
    const streamMarker = new TextEncoder().encode("stream");
    const endstreamMarker = new TextEncoder().encode("endstream");

    let searchPos = 0;
    while (searchPos < bytes.length - 20) {
      // Find "stream" marker
      const streamIdx = findBytes(bytes, streamMarker, searchPos);
      if (streamIdx === -1) break;

      // Skip past "stream\r\n" or "stream\n"
      let dataStart = streamIdx + 6;
      if (bytes[dataStart] === 0x0d && bytes[dataStart + 1] === 0x0a) {
        dataStart += 2;
      } else if (bytes[dataStart] === 0x0a) {
        dataStart += 1;
      } else if (bytes[dataStart] === 0x0d) {
        dataStart += 1;
      }

      // Find "endstream"
      const endIdx = findBytes(bytes, endstreamMarker, dataStart);
      if (endIdx === -1) {
        searchPos = dataStart;
        continue;
      }

      // Check if this stream uses FlateDecode by looking at the object header before "stream"
      const headerStart = Math.max(0, streamIdx - 500);
      const header = raw.substring(headerStart, streamIdx);
      const isFlateDecode = /\/Filter\s*\/FlateDecode/.test(header) ||
        /\/Filter\s*\[?\s*\/FlateDecode/.test(header);

      if (isFlateDecode) {
        const streamData = bytes.slice(dataStart, endIdx);
        try {
          const decompressed = pako.inflate(streamData);
          const text = new TextDecoder("utf-8", { fatal: false }).decode(decompressed);

          // Extract text operators from decompressed content
          const extracted = extractTextOperators(text);
          if (extracted.trim()) {
            textParts.push(extracted);
          }
        } catch {
          // Decompression failed for this stream, skip
        }
      }

      searchPos = endIdx + 9;
    }
  } catch {
    // Fallback silently
  }

  return textParts.join("\n").trim();
}

function findBytes(haystack: Uint8Array, needle: Uint8Array, start: number): number {
  outer: for (let i = start; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function extractTextOperators(content: string): string {
  const parts: string[] = [];

  // Extract text from Tj operator: (text) Tj
  const tjMatches = content.matchAll(/\(([^)]*(?:\\\)[^)]*)*)\)\s*Tj/g);
  for (const m of tjMatches) {
    parts.push(decodePdfString(m[1]));
  }

  // Extract text from TJ operator (array of strings): [(text) 123 (text)] TJ
  const tjArrayMatches = content.matchAll(/\[((?:\([^)]*(?:\\\)[^)]*)*\)\s*[-\d.]*\s*)*)\]\s*TJ/gi);
  for (const m of tjArrayMatches) {
    const innerMatches = m[1].matchAll(/\(([^)]*(?:\\\)[^)]*)*)\)/g);
    const innerParts: string[] = [];
    for (const im of innerMatches) {
      innerParts.push(decodePdfString(im[1]));
    }
    parts.push(innerParts.join(""));
  }

  // Extract text from Td/TD operators that indicate new lines
  // Add newlines where we see significant vertical movement
  let result = parts.join(" ");

  // Clean up excessive spaces
  result = result.replace(/\s{3,}/g, "\n").replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

function extractWithCMap(raw: string): string {
  // Simple fallback: extract anything that looks like readable text between BT/ET blocks
  const btBlocks = raw.matchAll(/BT\s*([\s\S]*?)\s*ET/g);
  const parts: string[] = [];
  for (const block of btBlocks) {
    const blockText = extractTextOperators(block[1]);
    if (blockText) parts.push(blockText);
  }
  return parts.join("\n").trim();
}

function decodePdfString(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

// ─── Text Quality Assessment ───────────────────────────────────────────

interface TextQuality {
  readable: boolean;
  score: number;
  wordCount: number;
  readableCharRatio: number;
  pdfSyntaxRatio: number;
  reason: string;
}

function assessTextQuality(text: string): TextQuality {
  if (!text || text.trim().length < 20) {
    return { readable: false, score: 0, wordCount: 0, readableCharRatio: 0, pdfSyntaxRatio: 0, reason: "too_short" };
  }

  const sample = text.slice(0, 10000);
  const totalChars = sample.length;

  // Count readable characters (letters, digits, common punctuation, spaces)
  const readableChars = (sample.match(/[a-zA-Z0-9\s.,;:!?'"()\-–—\/\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\u0600-\u06FF]/g) || []).length;
  const readableCharRatio = readableChars / totalChars;

  // Count PDF syntax tokens
  const pdfSyntaxTokens = (sample.match(/\b(obj|endobj|stream|endstream|FlateDecode|xref|trailer|startxref|\/Type|\/Font|\/Page|\/Length|\/Filter)\b/gi) || []).length;
  const words = sample.split(/\s+/).filter(Boolean);
  const pdfSyntaxRatio = words.length > 0 ? pdfSyntaxTokens / words.length : 1;

  // Count actual words (3+ letter sequences)
  const realWords = (sample.match(/[a-zA-Z\u00C0-\u024F\u0400-\u04FF]{3,}/g) || []).length;

  let score = 0;
  let reason = "ok";

  if (readableCharRatio < 0.4) {
    reason = "low_readable_char_ratio";
  } else if (pdfSyntaxRatio > 0.15) {
    reason = "high_pdf_syntax_ratio";
  } else if (realWords < 10) {
    reason = "too_few_real_words";
  } else {
    score = Math.min(1, readableCharRatio * (1 - pdfSyntaxRatio) * Math.min(realWords / 50, 1));
  }

  return {
    readable: score > 0.2,
    score,
    wordCount: realWords,
    readableCharRatio: Math.round(readableCharRatio * 100) / 100,
    pdfSyntaxRatio: Math.round(pdfSyntaxRatio * 100) / 100,
    reason,
  };
}

// ─── Language Detection ────────────────────────────────────────────────

function detectLanguage(text: string): { language: string; confidence: number } {
  if (!text || text.trim().length < 20) return { language: "unknown", confidence: 0 };

  const sample = text.slice(0, 5000).toLowerCase();

  const cyrillicCount = (sample.match(/[\u0400-\u04FF]/g) || []).length;
  if (cyrillicCount > sample.length * 0.2) return { language: "sr", confidence: 0.8 };

  const cjkCount = (sample.match(/[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
  if (cjkCount > sample.length * 0.1) return { language: "zh", confidence: 0.7 };

  const arabicCount = (sample.match(/[\u0600-\u06FF]/g) || []).length;
  if (arabicCount > sample.length * 0.2) return { language: "ar", confidence: 0.8 };

  const words = sample.split(/\s+/);
  const enWords = new Set(["the", "and", "is", "in", "to", "of", "a", "for", "that", "it", "with", "on", "as", "are", "was", "be", "this", "have", "from", "or", "an", "but", "not", "by", "at", "they", "which", "do", "their", "if", "will", "each", "about", "how", "up", "out", "them", "then", "she", "many", "some", "so", "these", "would", "other"]);
  const deWords = new Set(["der", "die", "und", "ist", "von", "den", "das", "mit", "auf", "für", "ein", "eine", "des", "dem", "nicht", "sich", "auch", "als", "noch", "nach", "bei", "aus", "wie", "aber", "wenn"]);
  const frWords = new Set(["le", "la", "les", "de", "des", "du", "un", "une", "et", "est", "en", "que", "qui", "dans", "pour", "pas", "sur", "ce", "par", "sont", "avec", "au", "aux", "mais", "ou", "ne"]);
  const esWords = new Set(["el", "la", "los", "las", "de", "en", "un", "una", "que", "es", "por", "con", "del", "para", "al", "se", "no", "su", "más", "como", "pero", "sus", "le", "ya", "este"]);

  let enScore = 0, deScore = 0, frScore = 0, esScore = 0;
  for (const w of words) {
    if (enWords.has(w)) enScore++;
    if (deWords.has(w)) deScore++;
    if (frWords.has(w)) frScore++;
    if (esWords.has(w)) esScore++;
  }

  const maxScore = Math.max(enScore, deScore, frScore, esScore);
  if (maxScore < 3) return { language: "en", confidence: 0.3 };
  if (maxScore === enScore) return { language: "en", confidence: Math.min(enScore / words.length * 10, 0.95) };
  if (maxScore === deScore) return { language: "de", confidence: Math.min(deScore / words.length * 10, 0.9) };
  if (maxScore === frScore) return { language: "fr", confidence: Math.min(frScore / words.length * 10, 0.9) };
  if (maxScore === esScore) return { language: "es", confidence: Math.min(esScore / words.length * 10, 0.9) };
  return { language: "en", confidence: 0.3 };
}

// ─── Helpers ───────────────────────────────────────────────────────────

function countStats(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return { word_count: words.length, char_count: text.length, line_count: text.split("\n").length };
}

function normalizeForSearch(text: string, fileName: string, summary?: string): string {
  const parts = [fileName, summary || "", text].filter(Boolean);
  return parts.join(" ").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function extractText(bytes: Uint8Array, mimeType: string, fileName: string): { text: string; method: string; quality: TextQuality } {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  // Plain text formats
  if (mimeType.startsWith("text/") || ["txt", "md", "csv", "rtf"].includes(ext)) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return { text, method: "plaintext", quality: assessTextQuality(text) };
  }

  // PDF
  if (ext === "pdf" || mimeType === "application/pdf") {
    const result = extractPdfText(bytes);
    return { text: result.text, method: result.method, quality: assessTextQuality(result.text) };
  }

  // DOCX
  if (ext === "docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const matches = raw.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
    const parts: string[] = [];
    for (const m of matches) parts.push(m[1]);
    const text = parts.join(" ");
    return { text, method: "docx_xml", quality: assessTextQuality(text) };
  }

  // XLSX/XLS
  if (["xlsx", "xls"].includes(ext)) {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const matches = raw.matchAll(/<t[^>]*>([^<]*)<\/t>/g);
    const parts: string[] = [];
    for (const m of matches) parts.push(m[1]);
    const text = parts.length > 0 ? parts.join(" ") : raw.replace(/[^ -~\n\r\t]/g, " ").replace(/\s+/g, " ").slice(0, 50000);
    return { text, method: "spreadsheet_xml", quality: assessTextQuality(text) };
  }

  // Fallback
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).slice(0, 50000);
  return { text, method: "fallback_decode", quality: assessTextQuality(text) };
}

function categorizeFile(fileType: string): string {
  switch (fileType) {
    case "pdf": return "pdf";
    case "doc": case "docx": return "word";
    case "xls": case "xlsx": case "csv": return "spreadsheet";
    case "txt": return "text";
    case "md": return "markdown";
    case "rtf": return "rich_text";
    default: return "other";
  }
}

const ACTIVE_STATES = new Set([
  "extracting_metadata", "extracting_content", "detecting_language", "summarizing", "indexing"
]);

// ─── Main Handler ──────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId } = await req.json();
    if (!documentId) {
      return new Response(JSON.stringify({ error: "documentId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: doc, error: docErr } = await supabase
      .from("documents").select("*").eq("id", documentId).single();

    if (docErr || !doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (doc.processing_status === "completed") {
      return new Response(JSON.stringify({ status: "already_completed", documentId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (ACTIVE_STATES.has(doc.processing_status)) {
      return new Response(JSON.stringify({ status: "already_processing", documentId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("documents").update({
      processing_status: "extracting_metadata",
      processing_error: null,
      retry_count: (doc.retry_count || 0) + 1,
      last_retry_at: new Date().toISOString(),
    }).eq("id", documentId);

    // Download file
    const { data: fileData, error: dlErr } = await supabase.storage
      .from("insight-navigator").download(doc.storage_path);

    if (dlErr || !fileData) {
      await supabase.from("documents").update({
        processing_status: "failed",
        processing_error: `Download failed: ${dlErr?.message || "unknown"}`,
      }).eq("id", documentId);
      return new Response(JSON.stringify({ error: "Failed to download file" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bytes = new Uint8Array(await fileData.arrayBuffer());

    // Extract content
    await supabase.from("documents").update({ processing_status: "extracting_content" }).eq("id", documentId);
    const extraction = extractText(bytes, doc.mime_type, doc.file_name);
    const stats = countStats(extraction.text);

    console.log(`[${documentId}] Extraction: method=${extraction.method}, quality_score=${extraction.quality.score}, readable=${extraction.quality.readable}, words=${extraction.quality.wordCount}, reason=${extraction.quality.reason}`);

    // If extraction produced no readable text, mark as failed
    if (!extraction.quality.readable) {
      await supabase.from("documents").update({
        processing_status: "failed",
        processing_error: `Text extraction failed: ${extraction.quality.reason} (method: ${extraction.method}, score: ${extraction.quality.score})`,
        word_count: stats.word_count,
        char_count: stats.char_count,
      }).eq("id", documentId);

      // Still persist whatever we got for diagnostics
      await supabase.from("document_analysis").upsert({
        document_id: documentId,
        user_id: doc.user_id,
        extracted_text: extraction.text.slice(0, 500000),
        normalized_search_text: null,
        metadata_json: {
          original_size: doc.file_size,
          mime_type: doc.mime_type,
          extraction_method: extraction.method,
          quality_score: extraction.quality.score,
          readable_char_ratio: extraction.quality.readableCharRatio,
          pdf_syntax_ratio: extraction.quality.pdfSyntaxRatio,
          quality_reason: extraction.quality.reason,
          file_category: categorizeFile(doc.file_type),
        },
        ocr_used: false,
      }, { onConflict: "document_id" });

      return new Response(JSON.stringify({
        status: "failed",
        documentId,
        reason: extraction.quality.reason,
        extraction_method: extraction.method,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Language detection
    await supabase.from("documents").update({
      processing_status: "detecting_language",
      word_count: stats.word_count,
      char_count: stats.char_count,
    }).eq("id", documentId);

    const langResult = detectLanguage(extraction.text);

    await supabase.from("documents").update({
      processing_status: "summarizing",
      detected_language: langResult.language,
    }).eq("id", documentId);

    // Generate summary using only clean extracted text
    let summary = "";
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (LOVABLE_API_KEY && extraction.text.trim().length > 50) {
      try {
        const textForSummary = extraction.text.slice(0, 8000);
        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: [
              { role: "system", content: "You are a document summarizer. Produce a concise summary of 2-5 sentences. Be factual, neutral, and informative. No markdown." },
              { role: "user", content: `Summarize this document titled "${doc.file_name}":\n\n${textForSummary}` },
            ],
          }),
        });
        if (aiResp.ok) {
          const aiData = await aiResp.json();
          summary = aiData.choices?.[0]?.message?.content || "";
        }
      } catch (e) {
        console.warn("Summary generation failed:", e);
      }
    }

    // Indexing
    await supabase.from("documents").update({
      processing_status: "indexing",
      summary: summary || null,
    }).eq("id", documentId);

    const searchText = normalizeForSearch(extraction.text, doc.file_name, summary);

    await supabase.from("document_analysis").upsert({
      document_id: documentId,
      user_id: doc.user_id,
      extracted_text: extraction.text.slice(0, 500000),
      normalized_search_text: searchText.slice(0, 500000),
      metadata_json: {
        original_size: doc.file_size,
        mime_type: doc.mime_type,
        word_count: stats.word_count,
        char_count: stats.char_count,
        line_count: stats.line_count,
        detected_language: langResult.language,
        language_confidence: langResult.confidence,
        file_category: categorizeFile(doc.file_type),
        extraction_method: extraction.method,
        quality_score: extraction.quality.score,
        readable_char_ratio: extraction.quality.readableCharRatio,
        pdf_syntax_ratio: extraction.quality.pdfSyntaxRatio,
      },
      ocr_used: false,
      indexed_at: new Date().toISOString(),
    }, { onConflict: "document_id" });

    await supabase.from("documents").update({
      processing_status: "completed",
      processing_error: null,
    }).eq("id", documentId);

    return new Response(JSON.stringify({
      status: "completed",
      documentId,
      word_count: stats.word_count,
      detected_language: langResult.language,
      summary_length: summary.length,
      extraction_method: extraction.method,
      quality_score: extraction.quality.score,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("process-document error:", e);
    try {
      const { documentId } = await req.clone().json();
      if (documentId) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, serviceKey);
        await supabase.from("documents").update({
          processing_status: "failed",
          processing_error: e instanceof Error ? e.message : "Unknown error",
        }).eq("id", documentId);
      }
    } catch { /* ignore */ }
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
