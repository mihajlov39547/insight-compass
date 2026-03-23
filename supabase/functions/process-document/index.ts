import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { extractText as extractPdfText } from "https://esm.sh/unpdf@0.12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Windows-1251 Decoder (Serbian Cyrillic) ───────────────────────────

const WIN1251_MAP: string[] = (() => {
  const map: string[] = new Array(256);
  for (let i = 0; i < 128; i++) map[i] = String.fromCharCode(i);
  const upper = [
    0x0402,0x0403,0x201A,0x0453,0x201E,0x2026,0x2020,0x2021,0x20AC,0x2030,0x0409,0x2039,0x040A,0x040C,0x040B,0x040F,
    0x0452,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0xFFFD,0x2122,0x0459,0x203A,0x045A,0x045C,0x045B,0x045F,
    0x00A0,0x040E,0x045E,0x0408,0x00A4,0x0490,0x00A6,0x00A7,0x0401,0x00A9,0x0404,0x00AB,0x00AC,0x00AD,0x00AE,0x0407,
    0x00B0,0x00B1,0x0406,0x0456,0x0491,0x00B5,0x00B6,0x00B7,0x0451,0x2116,0x0454,0x00BB,0x0458,0x0405,0x0455,0x0457,
    0x0410,0x0411,0x0412,0x0413,0x0414,0x0415,0x0416,0x0417,0x0418,0x0419,0x041A,0x041B,0x041C,0x041D,0x041E,0x041F,
    0x0420,0x0421,0x0422,0x0423,0x0424,0x0425,0x0426,0x0427,0x0428,0x0429,0x042A,0x042B,0x042C,0x042D,0x042E,0x042F,
    0x0430,0x0431,0x0432,0x0433,0x0434,0x0435,0x0436,0x0437,0x0438,0x0439,0x043A,0x043B,0x043C,0x043D,0x043E,0x043F,
    0x0440,0x0441,0x0442,0x0443,0x0444,0x0445,0x0446,0x0447,0x0448,0x0449,0x044A,0x044B,0x044C,0x044D,0x044E,0x044F,
  ];
  for (let i = 0; i < 128; i++) map[128 + i] = String.fromCharCode(upper[i]);
  return map;
})();

function decodeWindows1251(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i++) {
    result += WIN1251_MAP[bytes[i]];
  }
  return result;
}

// ─── Legacy .doc Extraction ────────────────────────────────────────────

function isOLE2(bytes: Uint8Array): boolean {
  return bytes.length >= 8 &&
    bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0 &&
    bytes[4] === 0xA1 && bytes[5] === 0xB2 && bytes[6] === 0x1A && bytes[7] === 0xE1;
}

function extractUTF16LEText(bytes: Uint8Array): string {
  // Try to find runs of UTF-16LE text in the binary
  const chunks: string[] = [];
  let currentChunk = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    // Accept printable chars, common unicode ranges, whitespace
    if (
      (code >= 0x20 && code <= 0x7E) ||  // ASCII printable
      (code >= 0x00A0 && code <= 0x024F) || // Latin extended
      (code >= 0x0400 && code <= 0x04FF) || // Cyrillic
      (code >= 0x0600 && code <= 0x06FF) || // Arabic
      (code >= 0x4E00 && code <= 0x9FFF) || // CJK
      code === 0x0D || code === 0x0A || code === 0x09 // CR/LF/Tab
    ) {
      currentChunk += String.fromCharCode(code);
    } else {
      if (currentChunk.trim().length >= 5) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = "";
    }
  }
  if (currentChunk.trim().length >= 5) chunks.push(currentChunk.trim());
  return chunks.join(" ");
}

function extractDocText(bytes: Uint8Array): { text: string; method: string; encoding: string } {
  // 1. Try UTF-16LE extraction (Unicode .doc files)
  const utf16Text = extractUTF16LEText(bytes);
  const utf16Quality = assessTextQuality(utf16Text);
  
  // 2. Try Windows-1251 for Cyrillic content
  const win1251Text = extractCleanWin1251(bytes);
  const win1251Quality = assessTextQuality(win1251Text);
  
  // 3. Try UTF-8 fallback
  const utf8Text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const cleanUtf8 = extractReadableSequences(utf8Text);
  const utf8Quality = assessTextQuality(cleanUtf8);
  
  // Pick best result
  const candidates = [
    { text: utf16Text, quality: utf16Quality, method: "doc_utf16le", encoding: "utf-16le" },
    { text: win1251Text, quality: win1251Quality, method: "doc_win1251", encoding: "windows-1251" },
    { text: cleanUtf8, quality: utf8Quality, method: "doc_utf8_fallback", encoding: "utf-8" },
  ];
  
  // Sort by: readable first, then by score, then by word count
  candidates.sort((a, b) => {
    if (a.quality.readable !== b.quality.readable) return a.quality.readable ? -1 : 1;
    if (a.quality.score !== b.quality.score) return b.quality.score - a.quality.score;
    return b.quality.wordCount - a.quality.wordCount;
  });
  
  const best = candidates[0];
  return { text: best.text, method: best.method, encoding: best.encoding };
}

function extractCleanWin1251(bytes: Uint8Array): string {
  const decoded = decodeWindows1251(bytes);
  return extractReadableSequences(decoded);
}

function extractReadableSequences(raw: string): string {
  // Extract sequences of readable characters (including Cyrillic)
  const sequences: string[] = [];
  let current = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (
      (c >= 0x20 && c <= 0x7E) ||  // ASCII printable
      (c >= 0x00A0 && c <= 0x024F) || // Latin extended
      (c >= 0x0400 && c <= 0x04FF) || // Cyrillic
      (c >= 0x0600 && c <= 0x06FF) || // Arabic
      (c >= 0x4E00 && c <= 0x9FFF) || // CJK
      c === 0x0A || c === 0x0D || c === 0x09 // whitespace
    ) {
      current += raw[i];
    } else {
      if (current.trim().length >= 4) sequences.push(current.trim());
      current = "";
    }
  }
  if (current.trim().length >= 4) sequences.push(current.trim());
  
  // Filter out sequences that look like binary noise (too many special chars)
  return sequences
    .filter(s => {
      const letterCount = (s.match(/[\p{L}\p{N}]/gu) || []).length;
      return letterCount / s.length > 0.3;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100000);
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

  // Count readable chars: Latin, digits, whitespace, punctuation, AND extended Unicode scripts
  const readableChars = (sample.match(/[\p{L}\p{N}\p{P}\p{Z}\p{S}]/gu) || []).length;
  const readableCharRatio = readableChars / totalChars;

  const pdfSyntaxTokens = (sample.match(/\b(obj|endobj|stream|endstream|FlateDecode|xref|trailer|startxref|\/Type|\/Font|\/Page|\/Length|\/Filter)\b/gi) || []).length;
  const words = sample.split(/\s+/).filter(Boolean);
  const pdfSyntaxRatio = words.length > 0 ? pdfSyntaxTokens / words.length : 1;

  // Count real words using Unicode letter property
  const realWords = (sample.match(/\p{L}{3,}/gu) || []).length;

  let score = 0;
  let reason = "ok";

  if (readableCharRatio < 0.3) {
    reason = "low_readable_char_ratio";
  } else if (pdfSyntaxRatio > 0.15) {
    reason = "high_pdf_syntax_ratio";
  } else if (realWords < 5) {
    reason = "too_few_real_words";
  } else {
    score = Math.min(1, readableCharRatio * (1 - pdfSyntaxRatio) * Math.min(realWords / 50, 1));
  }

  return {
    readable: score > 0.15,
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
  // Preserve Unicode letters and digits for non-Latin script support
  return parts.join(" ").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

async function extractText(bytes: Uint8Array, mimeType: string, fileName: string): Promise<{ text: string; method: string; encoding?: string; quality: TextQuality }> {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  // Plain text formats
  if (mimeType.startsWith("text/") || ["txt", "md", "csv", "rtf"].includes(ext)) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return { text, method: "plaintext", encoding: "utf-8", quality: assessTextQuality(text) };
  }

  // PDF — use unpdf library for proper extraction
  if (ext === "pdf" || mimeType === "application/pdf") {
    try {
      const result = await extractPdfText(bytes, { mergePages: true });
      const text = result.text || "";
      const quality = assessTextQuality(text);
      if (quality.readable) {
        return { text, method: "unpdf", quality };
      }
      return { text, method: "unpdf_low_quality", quality };
    } catch (e) {
      console.warn("unpdf extraction failed:", e);
      return { text: "", method: "unpdf_error", quality: assessTextQuality("") };
    }
  }

  // Legacy .doc (binary OLE2 Word format)
  if (ext === "doc" || mimeType === "application/msword") {
    const result = extractDocText(bytes);
    const quality = assessTextQuality(result.text);
    console.log(`[doc-extraction] method=${result.method}, encoding=${result.encoding}, textLen=${result.text.length}, isOLE2=${isOLE2(bytes)}`);
    return { text: result.text, method: result.method, encoding: result.encoding, quality };
  }

  // DOCX
  if (ext === "docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const matches = raw.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
    const parts: string[] = [];
    for (const m of matches) parts.push(m[1]);
    const text = parts.join(" ");
    return { text, method: "docx_xml", encoding: "utf-8", quality: assessTextQuality(text) };
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
    const extraction = await extractText(bytes, doc.mime_type, doc.file_name);
    const stats = countStats(extraction.text);

    console.log(`[${documentId}] Extraction: method=${extraction.method}, encoding=${extraction.encoding || "n/a"}, quality_score=${extraction.quality.score}, readable=${extraction.quality.readable}, words=${extraction.quality.wordCount}, readableCharRatio=${extraction.quality.readableCharRatio}, reason=${extraction.quality.reason}`);

    // If extraction produced no readable text, mark as failed
    if (!extraction.quality.readable) {
      await supabase.from("documents").update({
        processing_status: "failed",
        processing_error: `Text extraction failed: ${extraction.quality.reason} (method: ${extraction.method}, encoding: ${extraction.encoding || "n/a"}, score: ${extraction.quality.score})`,
        word_count: stats.word_count,
        char_count: stats.char_count,
      }).eq("id", documentId);

      await supabase.from("document_analysis").upsert({
        document_id: documentId,
        user_id: doc.user_id,
        extracted_text: extraction.text.slice(0, 500000),
        normalized_search_text: null,
        metadata_json: {
          original_size: doc.file_size,
          mime_type: doc.mime_type,
          extraction_method: extraction.method,
          extraction_encoding: extraction.encoding || null,
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
        extraction_encoding: extraction.encoding || null,
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

    // Generate summary
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
              { role: "system", content: "You are a document summarizer. Produce a concise summary of 2-5 sentences. Be factual, neutral, and informative. No markdown. If the document is in a non-English language, produce the summary in that language." },
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
        extraction_encoding: extraction.encoding || null,
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
      extraction_encoding: extraction.encoding || null,
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
